const crypto = require("crypto");
const { pool } = require("../../config/db");
const { sendVerificationCodeEmail } = require("./emailService");

const VERIFICATION_CODE_TTL_MINUTES = Math.max(
  1,
  Number.parseInt(String(process.env.EMAIL_VERIFICATION_TTL_MINUTES || "10"), 10)
);
const VERIFICATION_RESEND_COOLDOWN_SECONDS = Math.max(
  0,
  Number.parseInt(String(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS || "60"), 10)
);
const VERIFICATION_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(String(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS || "5"), 10)
);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function toDbDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function createSixDigitCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

async function getUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        full_name,
        email,
        email_verified,
        email_verification_code_hash,
        email_verification_expires_at,
        email_verification_attempts,
        last_verification_sent_at
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [normalizedEmail]
  );
  return rows[0] || null;
}

async function issueVerificationCodeForEmail(email, options = {}) {
  const user = await getUserByEmail(email);
  if (!user) {
    return { ok: false, status: 404, message: "Account not found." };
  }
  if (user.email_verified) {
    return { ok: false, status: 409, message: "Email is already verified." };
  }

  const forceSend = Boolean(options.forceSend);
  const lastSent = user.last_verification_sent_at ? new Date(user.last_verification_sent_at) : null;
  if (!forceSend && lastSent && !Number.isNaN(lastSent.getTime())) {
    const elapsedSeconds = Math.floor((Date.now() - lastSent.getTime()) / 1000);
    if (elapsedSeconds < VERIFICATION_RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        status: 429,
        message: `Please wait ${VERIFICATION_RESEND_COOLDOWN_SECONDS - elapsedSeconds}s before requesting a new code.`
      };
    }
  }

  const code = createSixDigitCode();
  const codeHash = hashVerificationCode(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);

  await pool.execute(
    `
      UPDATE users
      SET
        email_verification_code_hash = ?,
        email_verification_expires_at = ?,
        email_verification_attempts = 0,
        last_verification_sent_at = ?
      WHERE id = ?
    `,
    [codeHash, toDbDate(expiresAt), toDbDate(now), user.id]
  );

  await sendVerificationCodeEmail({
    toEmail: user.email,
    fullName: user.full_name,
    code
  });

  return {
    ok: true,
    status: 200,
    message: "Verification code sent.",
    email: user.email,
    expiresInSeconds: VERIFICATION_CODE_TTL_MINUTES * 60
  };
}

async function verifyCodeForEmail(email, code) {
  const normalizedEmail = normalizeEmail(email);
  const submittedCode = String(code || "").trim();
  if (!normalizedEmail || !submittedCode) {
    return { ok: false, status: 400, message: "Email and code are required." };
  }

  const user = await getUserByEmail(normalizedEmail);
  if (!user) {
    return { ok: false, status: 404, message: "Account not found." };
  }
  if (user.email_verified) {
    return { ok: true, status: 200, message: "Email is already verified." };
  }

  const expiresAt = user.email_verification_expires_at ? new Date(user.email_verification_expires_at) : null;
  const attempts = Number(user.email_verification_attempts || 0);
  const storedHash = String(user.email_verification_code_hash || "").trim();
  if (!storedHash || !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    await pool.execute(
      `
        UPDATE users
        SET
          email_verification_code_hash = NULL,
          email_verification_expires_at = NULL,
          email_verification_attempts = 0
        WHERE id = ?
      `,
      [user.id]
    );
    return { ok: false, status: 400, message: "Verification code has expired. Please request a new one." };
  }

  if (attempts >= VERIFICATION_MAX_ATTEMPTS) {
    await pool.execute(
      `
        UPDATE users
        SET
          email_verification_code_hash = NULL,
          email_verification_expires_at = NULL,
          email_verification_attempts = 0
        WHERE id = ?
      `,
      [user.id]
    );
    return { ok: false, status: 429, message: "Too many failed attempts. Request a new verification code." };
  }

  const submittedHash = hashVerificationCode(submittedCode);
  if (submittedHash !== storedHash) {
    await pool.execute(
      `
        UPDATE users
        SET email_verification_attempts = email_verification_attempts + 1
        WHERE id = ?
      `,
      [user.id]
    );
    return { ok: false, status: 400, message: "Invalid verification code." };
  }

  await pool.execute(
    `
      UPDATE users
      SET
        email_verified = 1,
        email_verification_code_hash = NULL,
        email_verification_expires_at = NULL,
        email_verification_attempts = 0
      WHERE id = ?
    `,
    [user.id]
  );

  return { ok: true, status: 200, message: "Email verified successfully." };
}

module.exports = {
  issueVerificationCodeForEmail,
  verifyCodeForEmail
};
