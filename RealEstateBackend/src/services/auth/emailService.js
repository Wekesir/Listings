const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const { pool } = require("../../config/db");

const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").trim().toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "no-reply@kenreal.local").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM = String(process.env.RESEND_FROM || SMTP_FROM || "no-reply@kenreal.local").trim();
const DEFAULT_EMAIL_PROVIDER = String(process.env.EMAIL_DELIVERY_PROVIDER || "resend").trim().toLowerCase();

let transporter = null;
let resendClient = null;

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (["resend", "smtp", "disabled"].includes(provider)) {
    return provider;
  }
  return "resend";
}

function hasMailerConfiguration() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);
}

function hasResendConfiguration() {
  return Boolean(RESEND_API_KEY && RESEND_FROM);
}

function getTransporter() {
  if (!hasMailerConfiguration()) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
  }
  return transporter;
}

function getResendClient() {
  if (!hasResendConfiguration()) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

async function getConfiguredDeliveryProvider() {
  try {
    const [rows] = await pool.execute(
      `
        SELECT setting_value
        FROM system_settings
        WHERE setting_key = 'email_delivery_provider'
        LIMIT 1
      `
    );
    const rawValue = rows?.[0]?.setting_value;
    if (!rawValue) {
      return normalizeProvider(DEFAULT_EMAIL_PROVIDER);
    }
    const parsedValue = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    return normalizeProvider(parsedValue?.provider || DEFAULT_EMAIL_PROVIDER);
  } catch (_error) {
    return normalizeProvider(DEFAULT_EMAIL_PROVIDER);
  }
}

async function sendVerificationCodeEmail({ toEmail, fullName, code }) {
  const safeName = String(fullName || "").trim() || "there";
  const safeCode = String(code || "").trim();
  const provider = await getConfiguredDeliveryProvider();
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">Verify your email address</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 12px;">Use the code below to verify your KenReal Estates account:</p>
      <p style="font-size: 28px; letter-spacing: 4px; font-weight: 700; margin: 16px 0;">${safeCode}</p>
      <p style="margin: 0 0 8px;">This code expires in 10 minutes.</p>
      <p style="margin: 0;">If you did not request this code, you can ignore this email.</p>
    </div>
  `;

  if (provider === "disabled") {
    console.warn("Email provider is disabled by admin setting.");
    return { skipped: true, provider };
  }

  if (provider === "smtp") {
    const mailer = getTransporter();
    if (!mailer) {
      console.warn("SMTP provider selected but not configured. Skipping verification email send.");
      return { skipped: true, provider };
    }
    await mailer.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: "Your KenReal Estates verification code",
      text: `Hi ${safeName}, your verification code is ${safeCode}. It expires in 10 minutes.`,
      html
    });
    return { skipped: false, provider };
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn("Resend provider selected but not configured. Skipping verification email send.");
    return { skipped: true, provider };
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: [toEmail],
    subject: "Your KenReal Estates verification code",
    text: `Hi ${safeName}, your verification code is ${safeCode}. It expires in 10 minutes.`,
    html
  });

  return { skipped: false, provider };
}

module.exports = {
  hasMailerConfiguration,
  hasResendConfiguration,
  sendVerificationCodeEmail,
  getConfiguredDeliveryProvider
};
