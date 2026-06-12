const { pool } = require("../config/db");
const properties = require("../data/properties");
const { applySoftDeleteFromModeration } = require("./propertyController");
const { ACCESS_ACTIONS, MODULE_KEYS, hasModulePermission } = require("../utils/accessControl");

const ALLOWED_REASON_CODES = new Set([
  "false_pricing",
  "misleading_media",
  "unavailable_or_duplicate",
  "spam_or_scam",
  "inappropriate_content",
  "harassment_or_discrimination",
  "other"
]);

const RESOLVE_OUTCOMES = new Set([
  "dismissed",
  "listing_suspended",
  "lister_suspended",
  "lister_banned",
  "both_suspended",
  "both_banned"
]);

function getSessionUserId(req) {
  const userId = Number(req.session?.user?.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

function isSoftDeletedProperty(property) {
  return Boolean(property?.isSoftDeleted);
}

function getClientMetadata(req) {
  const userAgent = req.headers["user-agent"] || null;
  const forwarded = req.headers["x-forwarded-for"];
  const ipAddress =
    typeof forwarded === "string" && forwarded.trim()
      ? forwarded.split(",")[0].trim()
      : req.ip || req.connection?.remoteAddress || null;
  return { ipAddress, userAgent, requestPath: req.originalUrl || req.path || null, httpMethod: req.method || null };
}

async function writeAudit(req, user, eventReason, details) {
  const meta = getClientMetadata(req);
  const userId = Number(user?.id);
  try {
    await pool.execute(
      `
        INSERT INTO auth_audit_logs (
          user_id,
          email,
          account_type,
          event_type,
          event_reason,
          session_id,
          ip_address,
          user_agent,
          device_type,
          platform,
          browser,
          os,
          accept_language,
          request_path,
          http_method,
          status_code,
          details
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        Number.isInteger(userId) && userId > 0 ? userId : null,
        user?.email || null,
        user?.accountType || null,
        "listing_report_resolved",
        eventReason,
        req.sessionID || null,
        meta.ipAddress,
        meta.userAgent,
        null,
        null,
        null,
        null,
        req.headers["accept-language"] || null,
        meta.requestPath,
        meta.httpMethod,
        200,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (error) {
    console.error("Failed to write audit log (listing report):", error.message);
  }
}

function normalizeNotes(value, maxLen = 2000) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeEmail(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  return s.length > 255 ? s.slice(0, 255) : s;
}

function isValidEmail(value) {
  if (!value) return false;
  // Simple, permissive validation — good enough for contact on a report.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function fetchUserRow(userId) {
  const [rows] = await pool.execute(
    `
      SELECT id, account_type, email, is_banned, suspended_until
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [Number(userId)]
  );
  return rows[0] || null;
}

async function applyBanUser(targetUserId, reason, req, adminUser) {
  await pool.execute(
    `
      UPDATE users
      SET
        is_banned = 1,
        banned_at = CURRENT_TIMESTAMP,
        ban_reason = ?,
        suspended_until = NULL,
        suspension_reason = NULL
      WHERE id = ?
    `,
    [reason, targetUserId]
  );
  await writeAudit(req, adminUser, "report_lister_banned", { targetUserId, reason });
}

async function applySuspendUser(targetUserId, durationHours, reason, req, adminUser) {
  const durationMs = Math.round(Number(durationHours) * 60 * 60 * 1000);
  const suspendedUntilDate = new Date(Date.now() + durationMs);
  const year = suspendedUntilDate.getUTCFullYear();
  const month = String(suspendedUntilDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(suspendedUntilDate.getUTCDate()).padStart(2, "0");
  const hour = String(suspendedUntilDate.getUTCHours()).padStart(2, "0");
  const minute = String(suspendedUntilDate.getUTCMinutes()).padStart(2, "0");
  const second = String(suspendedUntilDate.getUTCSeconds()).padStart(2, "0");
  const dbSuspendedUntil = `${year}-${month}-${day} ${hour}:${minute}:${second}`;

  await pool.execute(
    `
      UPDATE users
      SET
        suspended_until = ?,
        suspension_reason = ?,
        is_banned = 0,
        banned_at = NULL,
        ban_reason = NULL
      WHERE id = ?
    `,
    [dbSuspendedUntil, reason, targetUserId]
  );
  await writeAudit(req, adminUser, "report_lister_suspended", {
    targetUserId,
    durationHours: Number(durationHours),
    suspendedUntil: suspendedUntilDate.toISOString(),
    reason
  });
}

function enrichReportRows(rows) {
  return rows.map((row) => {
    const prop = properties.find((p) => Number(p.id) === Number(row.propertyId));
    return {
      ...row,
      propertyTitle: prop?.title || `Listing #${row.propertyId}`,
      propertyLocation: prop?.location || null
    };
  });
}

const submitListingReport = async (req, res) => {
  const reporterId = getSessionUserId(req);
  const sessionEmail = req.session?.user?.email || null;

  const propertyId = Number(req.params.id);
  if (!Number.isFinite(propertyId)) {
    return res.status(400).json({ message: "Invalid listing id." });
  }

  const property = properties.find((item) => Number(item.id) === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }

  const isAdminViewer = req.session?.user?.accountType === "admin";
  if (isSoftDeletedProperty(property) && !isAdminViewer) {
    return res.status(404).json({ message: "Property not found" });
  }

  const listerUserId = Number(property.ownerId);
  if (!Number.isFinite(listerUserId) || listerUserId <= 0) {
    return res.status(400).json({
      message: "This listing cannot be reported because it has no verified owner on file."
    });
  }

  if (reporterId && listerUserId === reporterId) {
    return res.status(400).json({ message: "You cannot report your own listing." });
  }

  const reasonCode = String(req.body?.reasonCode || "").trim().toLowerCase();
  const customDetail = normalizeNotes(req.body?.customDetail, 4000);

  if (!ALLOWED_REASON_CODES.has(reasonCode)) {
    return res.status(400).json({ message: "Please choose a valid report reason." });
  }

  if (reasonCode === "other" && !customDetail) {
    return res.status(400).json({ message: "Please describe the issue when you select “Other”." });
  }

  // Resolve a contact email for the report. If the user is logged in we use
  // their account email; otherwise we require one so we can follow up.
  const anonymousEmailRaw = req.body?.email;
  const anonymousEmail = normalizeEmail(anonymousEmailRaw);
  let contactEmail = null;

  if (reporterId) {
    contactEmail = sessionEmail ? String(sessionEmail).toLowerCase() : null;
  } else {
    if (!anonymousEmail) {
      return res.status(401).json({
        message:
          "Please sign in, or share an email address so we can follow up on your complaint.",
        requiresContact: true
      });
    }
    if (!isValidEmail(anonymousEmail)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
        requiresContact: true
      });
    }
    contactEmail = anonymousEmail;
  }

  // Prevent anonymous reporters from reporting their own listing via their email.
  if (!reporterId && contactEmail) {
    try {
      const [ownerRows] = await pool.execute(
        `SELECT id FROM users WHERE id = ? AND LOWER(email) = ? LIMIT 1`,
        [listerUserId, contactEmail]
      );
      if (ownerRows.length > 0) {
        return res.status(400).json({ message: "You cannot report your own listing." });
      }
    } catch (error) {
      console.error("submitListingReport owner-email lookup:", error);
    }
  }

  // Duplicate guards — in-app so we can respect NULL reporter_user_id semantics.
  try {
    if (reporterId) {
      const [dup] = await pool.execute(
        `
          SELECT id FROM listing_reports
          WHERE property_id = ? AND reporter_user_id = ?
          LIMIT 1
        `,
        [propertyId, reporterId]
      );
      if (dup.length > 0) {
        return res.status(409).json({
          message: "You have already submitted a report for this listing."
        });
      }
    } else {
      const [dup] = await pool.execute(
        `
          SELECT id FROM listing_reports
          WHERE property_id = ?
            AND reporter_user_id IS NULL
            AND reporter_email IS NOT NULL
            AND LOWER(reporter_email) = ?
          LIMIT 1
        `,
        [propertyId, contactEmail]
      );
      if (dup.length > 0) {
        return res.status(409).json({
          message: "We have already received a report from this email for this listing."
        });
      }
    }
  } catch (error) {
    console.error("submitListingReport dup-check:", error);
  }

  try {
    await pool.execute(
      `
        INSERT INTO listing_reports (
          property_id,
          lister_user_id,
          reporter_user_id,
          reporter_email,
          reason_code,
          custom_detail
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        propertyId,
        listerUserId,
        reporterId || null,
        contactEmail || null,
        reasonCode,
        customDetail || null
      ]
    );
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
      return res.status(409).json({
        message: "You have already submitted a report for this listing."
      });
    }
    console.error("submitListingReport:", error);
    return res.status(500).json({ message: "Could not submit your report right now." });
  }

  const confirmationMessage = reporterId
    ? "Thank you — your report has been submitted for review."
    : `Thank you — your report has been submitted. We'll follow up at ${contactEmail}.`;

  return res.status(201).json({
    message: confirmationMessage,
    anonymous: !reporterId
  });
};

const getAdminListingReports = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (!hasModulePermission(sessionUser, MODULE_KEYS.LISTING_REPORTS, ACCESS_ACTIONS.VIEW)) {
    return res.status(403).json({ message: "You do not have permission to review listing reports." });
  }

  const statusFilter = String(req.query?.status || "all").trim().toLowerCase();
  const reasonFilter = String(req.query?.reasonCode || "").trim().toLowerCase();
  const searchTermRaw = String(req.query?.search || "").trim();
  const propertyIdFilter = req.query?.propertyId != null && String(req.query.propertyId).trim() !== ""
    ? Number(req.query.propertyId)
    : null;
  const listerFilter = req.query?.listerUserId != null && String(req.query.listerUserId).trim() !== ""
    ? Number(req.query.listerUserId)
    : null;

  // Pagination
  const pageRaw = Number(req.query?.page);
  const limitRaw = Number(req.query?.limit);
  const page  = Number.isFinite(pageRaw)  && pageRaw  > 0 ? Math.floor(pageRaw)  : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 20;

  const conditions = [];
  const params = [];

  if (statusFilter === "open" || statusFilter === "closed") {
    conditions.push("r.status = ?");
    params.push(statusFilter);
  } else if (statusFilter !== "all") {
    return res.status(400).json({ message: "status must be open, closed, or all." });
  }

  if (reasonFilter && reasonFilter !== "all") {
    if (!ALLOWED_REASON_CODES.has(reasonFilter)) {
      return res.status(400).json({ message: "Invalid reason filter." });
    }
    conditions.push("r.reason_code = ?");
    params.push(reasonFilter);
  }

  if (propertyIdFilter !== null && Number.isFinite(propertyIdFilter)) {
    conditions.push("r.property_id = ?");
    params.push(propertyIdFilter);
  }

  if (listerFilter !== null && Number.isFinite(listerFilter)) {
    conditions.push("r.lister_user_id = ?");
    params.push(listerFilter);
  }

  if (searchTermRaw) {
    const search = searchTermRaw.slice(0, 120);
    const like = `%${search}%`;
    const parts = [
      "rep.full_name LIKE ?",
      "rep.email LIKE ?",
      "lister.full_name LIKE ?",
      "lister.email LIKE ?",
      "r.reporter_email LIKE ?",
      "r.custom_detail LIKE ?"
    ];
    const searchAsNumber = Number(search);
    if (Number.isFinite(searchAsNumber) && searchAsNumber > 0) {
      parts.push("r.id = ?", "r.property_id = ?");
    }
    conditions.push(`(${parts.join(" OR ")})`);
    params.push(like, like, like, like, like, like);
    if (Number.isFinite(searchAsNumber) && searchAsNumber > 0) {
      params.push(searchAsNumber, searchAsNumber);
    }
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    // Count matching rows (for pagination)
    const [countRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total
        FROM listing_reports r
        LEFT JOIN users rep ON rep.id = r.reporter_user_id
        LEFT JOIN users lister ON lister.id = r.lister_user_id
        ${whereSql}
      `,
      params
    );
    const totalCount = Number(countRows?.[0]?.total) || 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const effectivePage = Math.min(page, totalPages);
    const effectiveOffset = (effectivePage - 1) * limit;

    // Pagination values are integers already validated above, so it is safe
    // to interpolate them into the SQL directly (MySQL's prepared-statement
    // protocol rejects LIMIT/OFFSET placeholders in several driver modes).
    const [rows] = await pool.execute(
      `
        SELECT
          r.id AS id,
          r.property_id AS propertyId,
          r.lister_user_id AS listerUserId,
          r.reporter_user_id AS reporterUserId,
          r.reason_code AS reasonCode,
          r.custom_detail AS customDetail,
          r.status AS status,
          r.outcome AS outcome,
          r.resolved_at AS resolvedAt,
          r.resolved_by_admin_id AS resolvedByAdminId,
          r.admin_notes AS adminNotes,
          r.created_at AS createdAt,
          r.reporter_email AS reporterContactEmail,
          rep.full_name AS reporterName,
          rep.email AS reporterEmail,
          lister.full_name AS listerName,
          lister.email AS listerEmail,
          adm.full_name AS resolverName,
          (
            SELECT COUNT(*) FROM listing_reports lr2
            WHERE lr2.lister_user_id = r.lister_user_id
          ) AS listerTotalReports,
          (
            SELECT COUNT(*) FROM listing_reports lr3
            WHERE lr3.lister_user_id = r.lister_user_id AND lr3.status = 'open'
          ) AS listerOpenReports
        FROM listing_reports r
        LEFT JOIN users rep ON rep.id = r.reporter_user_id
        LEFT JOIN users lister ON lister.id = r.lister_user_id
        LEFT JOIN users adm ON adm.id = r.resolved_by_admin_id
        ${whereSql}
        ORDER BY (r.status = 'open') DESC, r.created_at DESC
        LIMIT ${limit} OFFSET ${effectiveOffset}
      `,
      params
    );

    const [[countOpen], [countClosed]] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS c FROM listing_reports WHERE status = 'open'`),
      pool.execute(`SELECT COUNT(*) AS c FROM listing_reports WHERE status = 'closed'`)
    ]);

    const data = enrichReportRows(
      rows.map((row) => ({
        ...row,
        listerTotalReports: Number(row.listerTotalReports) || 0,
        listerOpenReports: Number(row.listerOpenReports) || 0,
        isAnonymous: !row.reporterUserId,
        reporterDisplay:
          row.reporterName ||
          row.reporterEmail ||
          row.reporterContactEmail ||
          null,
        reporterEmail: row.reporterEmail || row.reporterContactEmail || null
      }))
    );

    return res.status(200).json({
      data,
      stats: {
        open: Number(countOpen?.[0]?.c) || 0,
        closed: Number(countClosed?.[0]?.c) || 0
      },
      pagination: {
        page: effectivePage,
        limit,
        total: totalCount,
        totalPages
      }
    });
  } catch (error) {
    console.error("getAdminListingReports:", error);
    return res.status(500).json({ message: "Failed to load listing reports." });
  }
};

const resolveListingReport = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (!hasModulePermission(sessionUser, MODULE_KEYS.LISTING_REPORTS, ACCESS_ACTIONS.MANAGE)) {
    return res.status(403).json({ message: "You do not have permission to resolve listing reports." });
  }

  const reportId = Number(req.params.reportId);
  if (!Number.isFinite(reportId)) {
    return res.status(400).json({ message: "Invalid report id." });
  }

  const outcome = String(req.body?.outcome || "").trim().toLowerCase();
  const adminNotes = normalizeNotes(req.body?.adminNotes);
  const suspendDurationHours = Number(req.body?.suspendDurationHours);
  const defaultSuspendHours = 168;

  if (!RESOLVE_OUTCOMES.has(outcome)) {
    return res.status(400).json({ message: "Invalid resolution outcome." });
  }

  const durationHours =
    Number.isFinite(suspendDurationHours) && suspendDurationHours > 0
      ? Math.min(suspendDurationHours, 24 * 365)
      : defaultSuspendHours;

  try {
    const [reportRows] = await pool.execute(
      `
        SELECT
          id,
          property_id AS propertyId,
          lister_user_id AS listerUserId,
          status
        FROM listing_reports
        WHERE id = ?
        LIMIT 1
      `,
      [reportId]
    );
    const report = reportRows[0];
    if (!report) {
      return res.status(404).json({ message: "Report not found." });
    }
    if (report.status !== "open") {
      return res.status(400).json({ message: "This report has already been resolved." });
    }

    const adminId = Number(sessionUser.id);
    const listerId = Number(report.listerUserId);
    const propertyId = Number(report.propertyId);

    const moderationReason = `listing_report:${reportId}`;
    const banReason = `Listing report #${reportId}`;

    if (outcome === "dismissed") {
      await pool.execute(
        `
          UPDATE listing_reports
          SET
            status = 'closed',
            outcome = 'dismissed',
            resolved_at = CURRENT_TIMESTAMP,
            resolved_by_admin_id = ?,
            admin_notes = ?
          WHERE id = ?
        `,
        [adminId, adminNotes || null, reportId]
      );
      await writeAudit(req, sessionUser, "report_dismissed", { reportId, propertyId, listerId });
      return res.status(200).json({ message: "Report marked as reviewed (no violation)." });
    }

    const affectsLister =
      outcome === "lister_suspended" ||
      outcome === "lister_banned" ||
      outcome === "both_suspended" ||
      outcome === "both_banned";

    if (affectsLister) {
      const targetUser = await fetchUserRow(listerId);
      if (!targetUser) {
        return res.status(404).json({ message: "Lister account not found." });
      }
      if (targetUser.account_type === "admin") {
        return res.status(403).json({ message: "Admin accounts cannot be restricted from a listing report." });
      }
    }

    let appliedListing = false;

    if (
      outcome === "listing_suspended" ||
      outcome === "both_suspended" ||
      outcome === "both_banned"
    ) {
      const del = applySoftDeleteFromModeration(propertyId, adminId, moderationReason);
      if (!del.ok && del.error === "not_found") {
        return res.status(404).json({ message: "Listing no longer exists." });
      }
      appliedListing = Boolean(del.ok);
    }

    if (outcome === "lister_suspended" || outcome === "both_suspended") {
      await applySuspendUser(
        listerId,
        durationHours,
        adminNotes || `Listing report #${reportId}`,
        req,
        sessionUser
      );
    }

    if (outcome === "lister_banned" || outcome === "both_banned") {
      await applyBanUser(listerId, adminNotes || banReason, req, sessionUser);
    }

    await pool.execute(
      `
        UPDATE listing_reports
        SET
          status = 'closed',
          outcome = ?,
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by_admin_id = ?,
          admin_notes = ?
        WHERE id = ?
      `,
      [outcome, adminId, adminNotes || null, reportId]
    );

    await writeAudit(req, sessionUser, "report_resolved", {
      reportId,
      outcome,
      propertyId,
      listerId,
      listingAction: appliedListing
    });

    return res.status(200).json({
      message: "Report resolved.",
      outcome,
      listingSuspended: appliedListing
    });
  } catch (error) {
    console.error("resolveListingReport:", error);
    return res.status(500).json({ message: "Failed to resolve this report." });
  }
};

module.exports = {
  submitListingReport,
  getAdminListingReports,
  resolveListingReport
};
