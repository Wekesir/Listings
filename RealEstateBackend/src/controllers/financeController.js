const PDFDocument = require("pdfkit");
const { pool } = require("../config/db");
const { ACCESS_ACTIONS, MODULE_KEYS, hasModulePermission } = require("../utils/accessControl");

function parsePositiveInt(value, fallback, max = null) {
  const numeric = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  if (Number.isInteger(max)) {
    return Math.min(numeric, max);
  }
  return numeric;
}

function parseMaybeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDateFilter(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  const seconds = String(parsed.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function toCsvValue(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function parsePaymentMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  try {
    return JSON.parse(String(metadata));
  } catch (_error) {
    return {};
  }
}

function parseSort(inputSortBy, inputSortDir) {
  const sortByMap = {
    createdAt: "lp.created_at",
    paidAt: "lp.paid_at",
    amount: "lp.amount",
    provider: "lp.provider",
    status: "lp.status"
  };
  const sortBy = sortByMap[String(inputSortBy || "").trim()] || "lp.created_at";
  const sortDir = String(inputSortDir || "").trim().toUpperCase() === "ASC" ? "ASC" : "DESC";
  return { sortBy, sortDir };
}

function getSessionUser(req, res) {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    res.status(401).json({ message: "Session expired. Please log in again." });
    return null;
  }
  return sessionUser;
}

function buildFinanceFilters({ query, includeUserFilters, fixedUserId = null }) {
  const whereParts = [];
  const whereValues = [];
  const status = String(query?.status || "").trim().toLowerCase();
  const provider = String(query?.provider || "").trim().toLowerCase();
  const listingType = String(query?.listingType || "").trim().toLowerCase();
  const checkoutRef = String(query?.checkoutRef || "").trim();
  const providerRef = String(query?.providerRef || "").trim();
  const paymentMethodLabel = String(query?.paymentMethodLabel || "").trim().toLowerCase();
  const email = String(query?.email || "").trim().toLowerCase();
  const q = String(query?.q || "").trim().toLowerCase();
  const propertyId = parsePositiveInt(query?.propertyId, null);
  const userId = parsePositiveInt(query?.userId, null);
  const minAmount = parseMaybeNumber(query?.minAmount);
  const maxAmount = parseMaybeNumber(query?.maxAmount);
  const fromDate = normalizeDateFilter(query?.fromDate);
  const toDate = normalizeDateFilter(query?.toDate);

  if (fixedUserId !== null) {
    whereParts.push("lp.user_id = ?");
    whereValues.push(Number(fixedUserId));
  }
  if (status && ["pending", "paid", "failed", "cancelled"].includes(status)) {
    whereParts.push("lp.status = ?");
    whereValues.push(status);
  }
  if (provider && ["mpesa", "stripe", "mock"].includes(provider)) {
    whereParts.push("lp.provider = ?");
    whereValues.push(provider);
  }
  if (listingType && ["rent", "lease"].includes(listingType)) {
    whereParts.push("p.type = ?");
    whereValues.push(listingType);
  }
  if (checkoutRef) {
    whereParts.push("lp.checkout_ref LIKE ?");
    whereValues.push(`%${checkoutRef}%`);
  }
  if (providerRef) {
    whereParts.push("lp.provider_ref LIKE ?");
    whereValues.push(`%${providerRef}%`);
  }
  if (paymentMethodLabel) {
    whereParts.push("LOWER(lp.payment_method_label) LIKE ?");
    whereValues.push(`%${paymentMethodLabel}%`);
  }
  if (propertyId) {
    whereParts.push("lp.property_id = ?");
    whereValues.push(propertyId);
  }
  if (minAmount !== null) {
    whereParts.push("lp.amount >= ?");
    whereValues.push(minAmount);
  }
  if (maxAmount !== null) {
    whereParts.push("lp.amount <= ?");
    whereValues.push(maxAmount);
  }
  if (fromDate) {
    whereParts.push("COALESCE(lp.paid_at, lp.created_at) >= ?");
    whereValues.push(fromDate);
  }
  if (toDate) {
    whereParts.push("COALESCE(lp.paid_at, lp.created_at) <= ?");
    whereValues.push(toDate);
  }

  if (includeUserFilters) {
    if (userId) {
      whereParts.push("lp.user_id = ?");
      whereValues.push(userId);
    }
    if (email) {
      whereParts.push("LOWER(u.email) LIKE ?");
      whereValues.push(`%${email}%`);
    }
  }

  if (q) {
    whereParts.push("(LOWER(u.email) LIKE ? OR LOWER(p.title) LIKE ? OR LOWER(lp.checkout_ref) LIKE ? OR LOWER(COALESCE(lp.provider_ref, '')) LIKE ?)");
    whereValues.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  return {
    whereClause: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    whereValues
  };
}

async function queryFinancePayments({ query, includeUserFilters, fixedUserId = null }) {
  const page = parsePositiveInt(query?.page, 1);
  const limit = parsePositiveInt(query?.limit, 25, 100);
  const offset = (page - 1) * limit;
  const { sortBy, sortDir } = parseSort(query?.sortBy, query?.sortDir);
  const { whereClause, whereValues } = buildFinanceFilters({ query, includeUserFilters, fixedUserId });

  const [rows] = await pool.execute(
    `
      SELECT
        lp.id,
        lp.property_id AS propertyId,
        lp.user_id AS userId,
        lp.amount,
        lp.amount_kes AS amountKes,
        lp.currency,
        lp.provider,
        lp.status,
        lp.payment_method_label AS paymentMethodLabel,
        lp.provider_ref AS providerRef,
        lp.checkout_ref AS checkoutRef,
        lp.receipt_number AS receiptNumber,
        lp.receipt_issued_at AS receiptIssuedAt,
        lp.paid_at AS paidAt,
        lp.metadata,
        lp.created_at AS createdAt,
        p.title AS propertyTitle,
        p.location AS propertyLocation,
        p.type AS propertyType,
        u.full_name AS userFullName,
        u.email AS userEmail
      FROM listing_payments lp
      LEFT JOIN properties p ON p.id = lp.property_id
      LEFT JOIN users u ON u.id = lp.user_id
      ${whereClause}
      ORDER BY ${sortBy} ${sortDir}, lp.id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    [...whereValues]
  );

  const [countRows] = await pool.execute(
    `
      SELECT COUNT(*) AS total
      FROM listing_payments lp
      LEFT JOIN properties p ON p.id = lp.property_id
      LEFT JOIN users u ON u.id = lp.user_id
      ${whereClause}
    `,
    [...whereValues]
  );

  const total = Number(countRows?.[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    rows,
    pagination: {
      total,
      page,
      limit,
      totalPages
    }
  };
}

async function queryFinanceSummary({ query, includeUserFilters, fixedUserId = null }) {
  const { whereClause, whereValues } = buildFinanceFilters({ query, includeUserFilters, fixedUserId });
  const whereWithPaid = whereClause
    ? `${whereClause} AND lp.status = 'paid'`
    : "WHERE lp.status = 'paid'";

  const [summaryRows] = await pool.execute(
    `
      SELECT
        COUNT(*) AS paidTransactionsCount,
        COALESCE(SUM(lp.amount), 0) AS grossRevenueUsd,
        COALESCE(SUM(lp.amount_kes), 0) AS grossRevenueKes
      FROM listing_payments lp
      LEFT JOIN properties p ON p.id = lp.property_id
      LEFT JOIN users u ON u.id = lp.user_id
      ${whereWithPaid}
    `,
    [...whereValues]
  );

  const [providerRows] = await pool.execute(
    `
      SELECT
        lp.provider AS provider,
        COUNT(*) AS transactionsCount,
        COALESCE(SUM(lp.amount), 0) AS grossRevenueUsd
      FROM listing_payments lp
      LEFT JOIN properties p ON p.id = lp.property_id
      LEFT JOIN users u ON u.id = lp.user_id
      ${whereWithPaid}
      GROUP BY lp.provider
      ORDER BY grossRevenueUsd DESC
    `,
    [...whereValues]
  );

  return {
    paidTransactionsCount: Number(summaryRows?.[0]?.paidTransactionsCount || 0),
    grossRevenueUsd: Number(summaryRows?.[0]?.grossRevenueUsd || 0),
    grossRevenueKes: Number(summaryRows?.[0]?.grossRevenueKes || 0),
    byProvider: providerRows.map((row) => ({
      provider: row.provider,
      transactionsCount: Number(row.transactionsCount || 0),
      grossRevenueUsd: Number(row.grossRevenueUsd || 0)
    }))
  };
}

async function getListerFinanceSummary(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;
  if (!["lister", "admin"].includes(String(sessionUser.accountType || "").toLowerCase())) {
    return res.status(403).json({ message: "Only lister or admin accounts can view lister finance summary." });
  }

  try {
    const summary = await queryFinanceSummary({
      query: req.query || {},
      includeUserFilters: false,
      fixedUserId: Number(sessionUser.id)
    });
    return res.status(200).json(summary);
  } catch (_error) {
    return res.status(500).json({ message: "Failed to load lister finance summary." });
  }
}

async function getListerFinancePayments(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;
  if (!["lister", "admin"].includes(String(sessionUser.accountType || "").toLowerCase())) {
    return res.status(403).json({ message: "Only lister or admin accounts can view lister payments." });
  }

  try {
    const result = await queryFinancePayments({
      query: req.query || {},
      includeUserFilters: false,
      fixedUserId: Number(sessionUser.id)
    });
    return res.status(200).json({
      data: result.rows,
      pagination: result.pagination
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to load lister payments." });
  }
}

async function getAdminFinanceSummary(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;
  if (!hasModulePermission(sessionUser, MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.VIEW)) {
    return res.status(403).json({ message: "You do not have permission to view finance summary." });
  }

  try {
    const summary = await queryFinanceSummary({
      query: req.query || {},
      includeUserFilters: true,
      fixedUserId: null
    });
    return res.status(200).json(summary);
  } catch (_error) {
    return res.status(500).json({ message: "Failed to load admin finance summary." });
  }
}

async function getAdminFinancePayments(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;
  if (!hasModulePermission(sessionUser, MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.VIEW)) {
    return res.status(403).json({ message: "You do not have permission to view finance payments." });
  }

  try {
    const result = await queryFinancePayments({
      query: req.query || {},
      includeUserFilters: true,
      fixedUserId: null
    });
    return res.status(200).json({
      data: result.rows,
      pagination: result.pagination
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to load admin payments." });
  }
}

async function getPaymentRecordForReceipt(paymentId) {
  const [rows] = await pool.execute(
    `
      SELECT
        lp.id,
        lp.property_id AS propertyId,
        lp.user_id AS userId,
        lp.amount,
        lp.amount_kes AS amountKes,
        lp.currency,
        lp.provider,
        lp.status,
        lp.payment_method_label AS paymentMethodLabel,
        lp.provider_ref AS providerRef,
        lp.checkout_ref AS checkoutRef,
        lp.receipt_number AS receiptNumber,
        lp.receipt_issued_at AS receiptIssuedAt,
        lp.paid_at AS paidAt,
        lp.metadata,
        lp.created_at AS createdAt,
        p.title AS propertyTitle,
        p.location AS propertyLocation,
        p.type AS propertyType,
        u.full_name AS userFullName,
        u.email AS userEmail
      FROM listing_payments lp
      LEFT JOIN properties p ON p.id = lp.property_id
      LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.id = ?
      LIMIT 1
    `,
    [Number(paymentId)]
  );
  return rows[0] || null;
}

async function ensureReceiptIdentifiers(payment) {
  if (!payment) return payment;
  if (payment.receiptNumber && payment.receiptIssuedAt) return payment;

  await pool.execute(
    `
      UPDATE listing_payments
      SET
        receipt_number = COALESCE(receipt_number, CONCAT('KRE-', DATE_FORMAT(CURRENT_TIMESTAMP, '%Y%m%d'), '-', LPAD(id, 8, '0'))),
        receipt_issued_at = COALESCE(receipt_issued_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `,
    [Number(payment.id)]
  );
  return getPaymentRecordForReceipt(payment.id);
}

/* ── PDF brand constants ── */
const PDF = {
  W: 595.28,
  H: 841.89,
  M: 50,
  get CW() { return this.W - 2 * this.M; },

  NAVY:     "#1e3a5f",
  NAVY_MID: "#2d5a8e",
  AMBER:    "#e8a020",
  LIGHT_BG: "#f7f9fc",
  TEXT:     "#1a2637",
  MUTED:    "#5a6a80",
  BORDER:   "#dce5ef",
  WHITE:    "#ffffff",
  SUCCESS:  "#1e7d45",
  DANGER:   "#c0392b",
  PENDING:  "#b07010",
};

function pdfStatusColor(status) {
  if (status === "paid") return PDF.SUCCESS;
  if (status === "failed" || status === "cancelled") return PDF.DANGER;
  return PDF.PENDING;
}

function pdfFmtDate(raw) {
  if (!raw) return "N/A";
  try {
    return new Date(raw).toLocaleString("en-KE", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch (_) { return String(raw); }
}

function pdfFmtDateShort(raw) {
  if (!raw) return "N/A";
  try {
    return new Date(raw).toLocaleDateString("en-KE", {
      year: "numeric", month: "short", day: "numeric"
    });
  } catch (_) { return String(raw); }
}

async function downloadPaymentReceiptPdf(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;

  try {
    const payment = await getPaymentRecordForReceipt(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found." });
    }

  const isAdmin = hasModulePermission(sessionUser, MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.VIEW);
    const isOwner = Number(payment.userId) === Number(sessionUser.id);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: "You are not allowed to download this receipt." });
    }

    const p = await ensureReceiptIdentifiers(payment);
    const metadata = parsePaymentMetadata(p.metadata);
    const quote = metadata?.pricingQuote || {};
    const receiptNumber = p.receiptNumber || `KRE-${p.id}`;
    const months = Number(quote?.months || 1);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${receiptNumber}.pdf"`);

    const doc = new PDFDocument({
      size: "A4",
      margin: PDF.M,
      info: {
        Title: `Receipt ${receiptNumber}`,
        Author: "KenReal Estates",
        Subject: "Payment Receipt",
        Keywords: "receipt payment kenreal estates"
      }
    });
    doc.pipe(res);

    const { W, H, M, CW } = PDF;

    /* ── 1. HEADER BAR ── */
    doc.rect(0, 0, W, 105).fill(PDF.NAVY);

    /* Logo block — amber rounded square with "KR" initials */
    doc.roundedRect(M, 21, 64, 64, 10).fill(PDF.AMBER);
    /* Decorative inner accent line */
    doc.rect(M + 4, 21 + 4, 56, 3).fill("rgba(255,255,255,0.25)");
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(28)
       .text("KR", M, 34, { width: 64, align: "center", lineBreak: false });

    /* Company name */
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(17)
       .text("KenReal Estates", M + 78, 30, { lineBreak: false });
    doc.fillColor("#8fb3d0").font("Helvetica").fontSize(8.5)
       .text("Premium Property Listings Platform", M + 78, 51, { lineBreak: false });
    doc.fillColor("#7098b5").font("Helvetica").fontSize(7.5)
       .text("info@kenreal.co.ke  |  www.kenreal.co.ke  |  Nairobi, Kenya", M + 78, 65, { lineBreak: false });

    /* "PAYMENT RECEIPT" aligned right */
    doc.fillColor(PDF.AMBER).font("Helvetica-Bold").fontSize(13)
       .text("PAYMENT RECEIPT", 0, 32, { width: W - M, align: "right", lineBreak: false });
    doc.fillColor("#8fb3d0").font("Helvetica").fontSize(8)
       .text("Official Tax Invoice", 0, 50, { width: W - M, align: "right", lineBreak: false });

    /* ── 2. AMBER ACCENT DIVIDER ── */
    doc.rect(0, 105, W, 3).fill(PDF.AMBER);

    /* ── 3. RECEIPT META STRIP ── */
    doc.rect(0, 108, W, 46).fill(PDF.LIGHT_BG);

    /* Receipt number */
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("RECEIPT NO.", M, 117, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica-Bold").fontSize(10)
       .text(receiptNumber, M, 127, { lineBreak: false });

    /* Issue date */
    const issueDateStr = pdfFmtDateShort(p.receiptIssuedAt || p.paidAt || p.createdAt);
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("ISSUE DATE", W / 2 - 55, 117, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica-Bold").fontSize(10)
       .text(issueDateStr, W / 2 - 55, 127, { lineBreak: false });

    /* Status pill */
    const sColor = pdfStatusColor(p.status);
    doc.roundedRect(W - M - 76, 119, 76, 22, 11).fill(sColor);
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(8.5)
       .text(String(p.status || "").toUpperCase(), W - M - 76, 125, { width: 76, align: "center", lineBreak: false });

    /* Bottom border */
    doc.rect(0, 154, W, 1).fill(PDF.BORDER);

    /* ── 4. BILLED TO + PAYMENT DETAILS (two columns) ── */
    const secY = 170;
    const colW = (CW - 24) / 2;
    const rightX = M + colW + 24;

    /* Left — BILLED TO */
    doc.fillColor(PDF.AMBER).font("Helvetica-Bold").fontSize(7)
       .text("BILLED TO", M, secY, { lineBreak: false });
    doc.moveTo(M, secY + 13).lineTo(M + colW, secY + 13)
       .lineWidth(0.6).strokeColor(PDF.BORDER).stroke();
    doc.fillColor(PDF.TEXT).font("Helvetica-Bold").fontSize(10.5)
       .text(p.userFullName || "N/A", M, secY + 18, { lineBreak: false });
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(9)
       .text(p.userEmail || "N/A", M, secY + 32, { lineBreak: false });

    /* Right — PAYMENT DETAILS */
    doc.fillColor(PDF.AMBER).font("Helvetica-Bold").fontSize(7)
       .text("PAYMENT DETAILS", rightX, secY, { lineBreak: false });
    doc.moveTo(rightX, secY + 13).lineTo(rightX + colW, secY + 13)
       .lineWidth(0.6).strokeColor(PDF.BORDER).stroke();

    const halfCol = colW / 2;

    /* Provider */
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("PROVIDER", rightX, secY + 18, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(9)
       .text(String(p.provider || "N/A").toUpperCase(), rightX, secY + 28, { lineBreak: false });

    /* Payment method */
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("PAYMENT METHOD", rightX + halfCol, secY + 18, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(9)
       .text(p.paymentMethodLabel || "N/A", rightX + halfCol, secY + 28, { lineBreak: false });

    /* Checkout ref */
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("CHECKOUT REF", rightX, secY + 46, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(8.5)
       .text(p.checkoutRef || "N/A", rightX, secY + 56, { lineBreak: false });

    /* Provider ref */
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("PROVIDER REF", rightX + halfCol, secY + 46, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(8.5)
       .text(p.providerRef || "N/A", rightX + halfCol, secY + 56, { lineBreak: false });

    /* ── 5. LISTING CARD ── */
    const lstY = 268;
    doc.rect(M, lstY, CW, 66).fill(PDF.LIGHT_BG);
    doc.rect(M, lstY, 4, 66).fill(PDF.AMBER); /* amber left accent */

    doc.fillColor(PDF.AMBER).font("Helvetica-Bold").fontSize(7)
       .text("LISTING", M + 14, lstY + 10, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica-Bold").fontSize(11)
       .text(p.propertyTitle || "Property Listing", M + 14, lstY + 22, { lineBreak: false });

    /* Listing type badge */
    if (p.propertyType) {
      const typeClr = String(p.propertyType).toLowerCase() === "lease" ? "#145a47" : "#1e3a5f";
      doc.roundedRect(M + 14, lstY + 42, 48, 14, 3).fill(typeClr);
      doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(7)
         .text(String(p.propertyType).toUpperCase(), M + 14, lstY + 46.5, { width: 48, align: "center", lineBreak: false });
    }

    /* Location */
    if (p.propertyLocation) {
      doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(9)
         .text(p.propertyLocation, M + 72, lstY + 44, { lineBreak: false });
    }

    /* ── 6. AMOUNT TABLE ── */
    const tblY = 354;

    /* Table header */
    doc.rect(M, tblY, CW, 26).fill(PDF.NAVY);
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(8)
       .text("DESCRIPTION", M + 12, tblY + 9, { lineBreak: false });
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(8)
       .text("AMOUNT (USD)", W - M - 135, tblY + 9, { width: 65, align: "right", lineBreak: false });
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(8)
       .text("AMOUNT (KES)", W - M - 65, tblY + 9, { width: 65, align: "right", lineBreak: false });

    /* Line item */
    doc.rect(M, tblY + 26, CW, 30).fill(PDF.WHITE);
    doc.moveTo(M, tblY + 56).lineTo(M + CW, tblY + 56).lineWidth(0.5).strokeColor(PDF.BORDER).stroke();
    const billingDesc = months > 1
      ? `Listing sponsorship package — ${months} month${months > 1 ? "s" : ""}`
      : "Listing sponsorship package — 1 month";
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(9.5)
       .text(billingDesc, M + 12, tblY + 36, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(9.5)
       .text(`$${Number(p.amount || 0).toFixed(2)}`, W - M - 135, tblY + 36, { width: 65, align: "right", lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(9.5)
       .text(`KSh ${Number(p.amountKes || 0).toFixed(2)}`, W - M - 65, tblY + 36, { width: 65, align: "right", lineBreak: false });

    /* Total row */
    doc.rect(M, tblY + 56, CW, 32).fill(PDF.LIGHT_BG);
    doc.fillColor(PDF.NAVY).font("Helvetica-Bold").fontSize(10.5)
       .text("TOTAL PAID", M + 12, tblY + 66, { lineBreak: false });
    doc.fillColor(PDF.NAVY).font("Helvetica-Bold").fontSize(10.5)
       .text(`$${Number(p.amount || 0).toFixed(2)}`, W - M - 135, tblY + 66, { width: 65, align: "right", lineBreak: false });
    doc.fillColor(PDF.NAVY).font("Helvetica-Bold").fontSize(10.5)
       .text(`KSh ${Number(p.amountKes || 0).toFixed(2)}`, W - M - 65, tblY + 66, { width: 65, align: "right", lineBreak: false });

    /* ── 7. TRANSACTION DATES STRIP ── */
    const dtY = tblY + 100;
    doc.rect(M, dtY, CW, 54).fill(PDF.LIGHT_BG);
    doc.rect(M, dtY, CW, 2).fill(PDF.BORDER);
    doc.rect(M, dtY + 52, CW, 2).fill(PDF.BORDER);

    const halfCW = CW / 2;
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("TRANSACTION INITIATED", M + 12, dtY + 10, { lineBreak: false });
    doc.fillColor(PDF.TEXT).font("Helvetica").fontSize(9)
       .text(pdfFmtDate(p.createdAt), M + 12, dtY + 21, { lineBreak: false });

    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(7)
       .text("PAYMENT CONFIRMED", M + halfCW + 12, dtY + 10, { lineBreak: false });
    doc.fillColor(p.paidAt ? PDF.TEXT : PDF.MUTED).font("Helvetica").fontSize(9)
       .text(p.paidAt ? pdfFmtDate(p.paidAt) : "Pending", M + halfCW + 12, dtY + 21, { lineBreak: false });

    /* Vertical separator */
    doc.moveTo(M + halfCW, dtY + 8).lineTo(M + halfCW, dtY + 44)
       .lineWidth(0.5).strokeColor(PDF.BORDER).stroke();

    /* ── 8. THANK-YOU NOTE ── */
    const noteY = dtY + 70;
    doc.roundedRect(M, noteY, CW, 44, 6).fill("#eef5ff");
    doc.rect(M, noteY, 4, 44).fill(PDF.AMBER);
    doc.fillColor(PDF.NAVY).font("Helvetica-Bold").fontSize(9.5)
       .text("Thank you for choosing KenReal Estates!", M + 16, noteY + 10, { lineBreak: false });
    doc.fillColor(PDF.MUTED).font("Helvetica").fontSize(8.5)
       .text("Your property sponsorship helps connect tenants with their perfect homes.", M + 16, noteY + 24, { lineBreak: false });

    /* ── 9. FOOTER ── */
    const footerY = H - 88;
    doc.rect(0, footerY, W, 3).fill(PDF.AMBER);
    doc.rect(0, footerY + 3, W, 85).fill(PDF.NAVY);

    /* Company info — left */
    doc.fillColor(PDF.WHITE).font("Helvetica-Bold").fontSize(10)
       .text("KenReal Estates", M, footerY + 15, { lineBreak: false });
    doc.fillColor("#8fb3d0").font("Helvetica").fontSize(8)
       .text("Premium Property Listings Platform", M, footerY + 28, { lineBreak: false });
    doc.fillColor("#7098b5").font("Helvetica").fontSize(7.5)
       .text("Nairobi, Kenya", M, footerY + 40, { lineBreak: false });

    /* Contact — center */
    doc.fillColor("#8fb3d0").font("Helvetica").fontSize(8)
       .text("www.kenreal.co.ke", W / 2, footerY + 15, { width: 150, align: "center", lineBreak: false });
    doc.fillColor("#8fb3d0").font("Helvetica").fontSize(8)
       .text("info@kenreal.co.ke", W / 2, footerY + 28, { width: 150, align: "center", lineBreak: false });

    /* Generated notice — right */
    doc.fillColor("#7098b5").font("Helvetica").fontSize(7)
       .text(`Generated: ${pdfFmtDateShort(new Date())}`, W - M - 140, footerY + 15, { width: 140, align: "right", lineBreak: false });
    doc.fillColor("#7098b5").font("Helvetica").fontSize(7)
       .text(`Receipt: ${receiptNumber}`, W - M - 140, footerY + 27, { width: 140, align: "right", lineBreak: false });

    /* Disclaimer line */
    doc.rect(M, footerY + 55, CW, 0.5).fill("#3a5a80");
    doc.fillColor("#506d8a").font("Helvetica").fontSize(6.5)
       .text(
         "This is a computer-generated receipt and requires no physical signature. Please retain this document for your records. " +
         "For billing enquiries contact info@kenreal.co.ke.",
         M, footerY + 62, { width: CW, align: "center", lineBreak: false }
       );

    doc.end();
    return undefined;
  } catch (_error) {
    return res.status(500).json({ message: "Failed to generate receipt PDF." });
  }
}

async function exportFinanceCsv(req, res, includeUserFilters, fixedUserId = null) {
  const result = await queryFinancePayments({
    query: {
      ...req.query,
      page: 1,
      limit: 1000
    },
    includeUserFilters,
    fixedUserId
  });

  const header = [
    "id",
    "receipt_number",
    "created_at",
    "paid_at",
    "status",
    "provider",
    "payment_method_label",
    "amount_usd",
    "amount_kes",
    "currency",
    "property_id",
    "property_title",
    "property_type",
    "user_id",
    "user_name",
    "user_email",
    "checkout_ref",
    "provider_ref"
  ];

  const lines = [header.map(toCsvValue).join(",")];
  result.rows.forEach((row) => {
    lines.push(
      [
        row.id,
        row.receiptNumber,
        row.createdAt,
        row.paidAt,
        row.status,
        row.provider,
        row.paymentMethodLabel,
        row.amount,
        row.amountKes,
        row.currency,
        row.propertyId,
        row.propertyTitle,
        row.propertyType,
        row.userId,
        row.userFullName,
        row.userEmail,
        row.checkoutRef,
        row.providerRef
      ].map(toCsvValue).join(",")
    );
  });

  const filename = `finances-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(lines.join("\n"));
}

async function exportListerFinanceCsv(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;
  if (!["lister", "admin"].includes(String(sessionUser.accountType || "").toLowerCase())) {
    return res.status(403).json({ message: "Only lister or admin accounts can export lister finance CSV." });
  }
  try {
    return await exportFinanceCsv(req, res, false, Number(sessionUser.id));
  } catch (_error) {
    return res.status(500).json({ message: "Failed to export lister finance CSV." });
  }
}

async function exportAdminFinanceCsv(req, res) {
  const sessionUser = getSessionUser(req, res);
  if (!sessionUser) return;
  if (!hasModulePermission(sessionUser, MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.MANAGE)) {
    return res.status(403).json({ message: "You do not have permission to export admin finance CSV." });
  }
  try {
    return await exportFinanceCsv(req, res, true, null);
  } catch (_error) {
    return res.status(500).json({ message: "Failed to export admin finance CSV." });
  }
}

module.exports = {
  getListerFinanceSummary,
  getListerFinancePayments,
  getAdminFinanceSummary,
  getAdminFinancePayments,
  downloadPaymentReceiptPdf,
  exportListerFinanceCsv,
  exportAdminFinanceCsv
};
