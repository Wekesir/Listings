const cron = require("node-cron");
const { pool } = require("../config/db");
const {
  sendSponsorshipEndingSoonEmail,
  sendSponsorshipExpiredEmail
} = require("../services/auth/emailService");

const DEFAULT_SCHEDULE = "*/15 * * * *";
const CRON_SCHEDULE = String(process.env.SPONSORSHIP_CRON_SCHEDULE || DEFAULT_SCHEDULE).trim() || DEFAULT_SCHEDULE;
const CRON_TIMEZONE = String(process.env.SPONSORSHIP_CRON_TIMEZONE || "").trim();

let isRunning = false;

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateTime(value) {
  const parsed = toDate(value);
  if (!parsed) return null;
  return parsed.toISOString();
}

async function processWarningNotifications() {
  const [rows] = await pool.execute(
    `
      SELECT
        p.id,
        p.title,
        p.location,
        p.visibility_expires_at AS visibilityExpiresAt,
        p.owner_id AS ownerId,
        u.full_name AS ownerFullName,
        u.email AS ownerEmail
      FROM properties p
      INNER JOIN users u ON u.id = p.owner_id
      WHERE p.payment_status = 'paid'
        AND p.visibility_expires_at IS NOT NULL
        AND p.visibility_expires_at > UTC_TIMESTAMP()
        AND p.visibility_expires_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
        AND p.sponsorship_warning_sent_at IS NULL
      ORDER BY p.visibility_expires_at ASC, p.id ASC
      LIMIT 500
    `
  );

  let warnedCount = 0;
  let warningFailures = 0;
  for (const row of rows) {
    try {
      await sendSponsorshipEndingSoonEmail({
        toEmail: row.ownerEmail,
        fullName: row.ownerFullName,
        listingTitle: row.title,
        listingLocation: row.location,
        visibilityExpiresAt: row.visibilityExpiresAt
      });
      await pool.execute(
        `
          UPDATE properties
          SET sponsorship_warning_sent_at = UTC_TIMESTAMP()
          WHERE id = ?
            AND sponsorship_warning_sent_at IS NULL
        `,
        [Number(row.id)]
      );
      warnedCount += 1;
    } catch (_error) {
      warningFailures += 1;
    }
  }

  return { warningCandidates: rows.length, warnedCount, warningFailures };
}

async function processExpiredDowngrades() {
  const [rows] = await pool.execute(
    `
      SELECT
        id
      FROM properties
      WHERE payment_status = 'paid'
        AND visibility_expires_at IS NOT NULL
        AND visibility_expires_at <= UTC_TIMESTAMP()
      ORDER BY visibility_expires_at ASC, id ASC
      LIMIT 500
    `
  );

  let downgradedCount = 0;
  for (const row of rows) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `
          UPDATE properties
          SET
            payment_status = 'expired',
            premium_media_unlocked = 0,
            listing_status = 'draft',
            is_published = 0,
            is_expired = 1,
            expired_at = COALESCE(expired_at, UTC_TIMESTAMP())
          WHERE id = ?
            AND payment_status = 'paid'
        `,
        [Number(row.id)]
      );
      await connection.commit();
      downgradedCount += 1;
    } catch (_error) {
      await connection.rollback();
    } finally {
      connection.release();
    }
  }

  return { downgradeCandidates: rows.length, downgradedCount };
}

async function processExpiredNotifications() {
  const [rows] = await pool.execute(
    `
      SELECT
        p.id,
        p.title,
        p.location,
        p.visibility_expires_at AS visibilityExpiresAt,
        p.owner_id AS ownerId,
        u.full_name AS ownerFullName,
        u.email AS ownerEmail
      FROM properties p
      INNER JOIN users u ON u.id = p.owner_id
      WHERE p.payment_status = 'expired'
        AND p.visibility_expires_at IS NOT NULL
        AND p.visibility_expires_at <= UTC_TIMESTAMP()
        AND p.sponsorship_expired_notice_sent_at IS NULL
      ORDER BY p.visibility_expires_at ASC, p.id ASC
      LIMIT 500
    `
  );

  let expiredNotifiedCount = 0;
  let expiredNotificationFailures = 0;
  for (const row of rows) {
    try {
      await sendSponsorshipExpiredEmail({
        toEmail: row.ownerEmail,
        fullName: row.ownerFullName,
        listingTitle: row.title,
        listingLocation: row.location,
        visibilityExpiresAt: row.visibilityExpiresAt
      });
      await pool.execute(
        `
          UPDATE properties
          SET sponsorship_expired_notice_sent_at = UTC_TIMESTAMP()
          WHERE id = ?
            AND sponsorship_expired_notice_sent_at IS NULL
        `,
        [Number(row.id)]
      );
      expiredNotifiedCount += 1;
    } catch (_error) {
      expiredNotificationFailures += 1;
    }
  }

  return {
    expiredNoticeCandidates: rows.length,
    expiredNotifiedCount,
    expiredNotificationFailures
  };
}

async function runSponsorshipExpiryCycle() {
  if (isRunning) {
    return {
      skipped: true,
      reason: "already_running"
    };
  }

  isRunning = true;
  try {
    const warningResult = await processWarningNotifications();
    const downgradeResult = await processExpiredDowngrades();
    const expiryNotificationResult = await processExpiredNotifications();

    return {
      skipped: false,
      ...warningResult,
      ...downgradeResult,
      ...expiryNotificationResult,
      processedAt: formatDateTime(new Date())
    };
  } finally {
    isRunning = false;
  }
}

function startSponsorshipExpiryCron() {
  const scheduleToUse = cron.validate(CRON_SCHEDULE) ? CRON_SCHEDULE : DEFAULT_SCHEDULE;
  if (scheduleToUse !== CRON_SCHEDULE) {
    console.warn(
      `[sponsorship-cron] Invalid schedule "${CRON_SCHEDULE}". Falling back to "${DEFAULT_SCHEDULE}".`
    );
  }

  const task = cron.schedule(
    scheduleToUse,
    async () => {
      try {
        const result = await runSponsorshipExpiryCycle();
        if (result?.skipped) {
          console.log("[sponsorship-cron] skipped: previous run still in progress");
          return;
        }
        console.log(
          "[sponsorship-cron]",
          JSON.stringify({
            warningCandidates: result.warningCandidates,
            warnedCount: result.warnedCount,
            warningFailures: result.warningFailures,
            downgradeCandidates: result.downgradeCandidates,
            downgradedCount: result.downgradedCount,
            expiredNoticeCandidates: result.expiredNoticeCandidates,
            expiredNotifiedCount: result.expiredNotifiedCount,
            expiredNotificationFailures: result.expiredNotificationFailures
          })
        );
      } catch (error) {
        console.error("[sponsorship-cron] run failed:", error.message);
      }
    },
    {
      timezone: CRON_TIMEZONE || undefined
    }
  );

  console.log(
    `[sponsorship-cron] started with schedule "${scheduleToUse}"${CRON_TIMEZONE ? ` (timezone: ${CRON_TIMEZONE})` : ""}`
  );
  return task;
}

module.exports = {
  runSponsorshipExpiryCycle,
  startSponsorshipExpiryCron
};
