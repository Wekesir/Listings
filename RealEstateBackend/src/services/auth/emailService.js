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

function buildListingLabel({ listingTitle, listingLocation }) {
  const safeTitle = String(listingTitle || "").trim() || "Your listing";
  const safeLocation = String(listingLocation || "").trim();
  return safeLocation ? `${safeTitle} (${safeLocation})` : safeTitle;
}

async function sendNewMessageNotificationEmail({
  toEmail,
  recipientName,
  senderName,
  listingTitle,
  listingLocation,
  unreadCount,
  messagePreview,
  conversationUrl
}) {
  const safeRecipientName = String(recipientName || "").trim() || "there";
  const safeSenderName = String(senderName || "").trim() || "A potential client";
  const listingLabel = buildListingLabel({ listingTitle, listingLocation });
  const unread = Math.max(1, Number(unreadCount) || 1);
  const safeMessagePreview = String(messagePreview || "").trim();
  const safeConversationUrl = String(conversationUrl || "").trim();
  const unreadLabel = unread === 1 ? "1 unread message" : `${unread} unread messages`;
  const provider = await getConfiguredDeliveryProvider();

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">You have a new inquiry</h2>
      <p style="margin: 0 0 12px;">Hi ${safeRecipientName},</p>
      <p style="margin: 0 0 12px;">
        ${safeSenderName} sent ${unread === 1 ? "you a message" : "new messages"} about <strong>${listingLabel}</strong>.
      </p>
      <p style="margin: 0 0 12px;"><strong>${unreadLabel}</strong></p>
      ${safeMessagePreview ? `<p style="margin: 0 0 12px; color: #3f4a59;">Latest message: "${safeMessagePreview}"</p>` : ""}
      ${
  safeConversationUrl
    ? `<a href="${safeConversationUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;">Open conversation</a>`
    : ""
}
      <p style="margin: 14px 0 0; color: #596a80;">You can reply from your messages inbox.</p>
    </div>
  `;
  const text = [
    `Hi ${safeRecipientName},`,
    "",
    `${safeSenderName} sent ${unread === 1 ? "you a message" : "new messages"} about ${listingLabel}.`,
    unreadLabel,
    safeMessagePreview ? `Latest message: "${safeMessagePreview}"` : "",
    safeConversationUrl ? `Open conversation: ${safeConversationUrl}` : ""
  ].filter(Boolean).join("\n");

  if (provider === "disabled") {
    console.warn("Email provider is disabled by admin setting.");
    return { skipped: true, provider };
  }

  if (provider === "smtp") {
    const mailer = getTransporter();
    if (!mailer) {
      console.warn("SMTP provider selected but not configured. Skipping message notification email send.");
      return { skipped: true, provider };
    }
    await mailer.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: "New message on KenReal Estates",
      text,
      html
    });
    return { skipped: false, provider };
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn("Resend provider selected but not configured. Skipping message notification email send.");
    return { skipped: true, provider };
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: [toEmail],
    subject: "New message on KenReal Estates",
    text,
    html
  });
  return { skipped: false, provider };
}

async function sendSponsorshipEndingSoonEmail({
  toEmail,
  fullName,
  listingTitle,
  listingLocation,
  visibilityExpiresAt
}) {
  const safeName = String(fullName || "").trim() || "there";
  const listingLabel = buildListingLabel({ listingTitle, listingLocation });
  const expiresAt = visibilityExpiresAt ? new Date(visibilityExpiresAt) : null;
  const expiresAtText = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? expiresAt.toLocaleString("en-KE")
    : "within 24 hours";
  const provider = await getConfiguredDeliveryProvider();
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">Sponsorship ending soon</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 12px;">
        Your sponsored listing <strong>${listingLabel}</strong> is scheduled to expire on <strong>${expiresAtText}</strong>.
      </p>
      <p style="margin: 0 0 8px;">
        Renew sponsorship before expiry to keep this listing in promoted placement.
      </p>
      <p style="margin: 0;">
        If you already renewed recently, you can ignore this reminder.
      </p>
    </div>
  `;
  const text = `Hi ${safeName}, your sponsored listing "${listingLabel}" is scheduled to expire on ${expiresAtText}. Renew to keep promoted placement.`;

  if (provider === "disabled") {
    console.warn("Email provider is disabled by admin setting.");
    return { skipped: true, provider };
  }
  if (provider === "smtp") {
    const mailer = getTransporter();
    if (!mailer) {
      console.warn("SMTP provider selected but not configured. Skipping sponsorship reminder email send.");
      return { skipped: true, provider };
    }
    await mailer.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: "Your listing sponsorship expires soon",
      text,
      html
    });
    return { skipped: false, provider };
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn("Resend provider selected but not configured. Skipping sponsorship reminder email send.");
    return { skipped: true, provider };
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: [toEmail],
    subject: "Your listing sponsorship expires soon",
    text,
    html
  });
  return { skipped: false, provider };
}

async function sendSponsorshipExpiredEmail({
  toEmail,
  fullName,
  listingTitle,
  listingLocation,
  visibilityExpiresAt
}) {
  const safeName = String(fullName || "").trim() || "there";
  const listingLabel = buildListingLabel({ listingTitle, listingLocation });
  const expiredAt = visibilityExpiresAt ? new Date(visibilityExpiresAt) : null;
  const expiredAtText = expiredAt && !Number.isNaN(expiredAt.getTime())
    ? expiredAt.toLocaleString("en-KE")
    : "recently";
  const provider = await getConfiguredDeliveryProvider();
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">Sponsorship expired</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 12px;">
        Your sponsored listing <strong>${listingLabel}</strong> expired on <strong>${expiredAtText}</strong>.
      </p>
      <p style="margin: 0 0 8px;">
        The listing has been removed from sponsored placement. Renew sponsorship to reactivate promoted visibility.
      </p>
      <p style="margin: 0;">
        Visit your listings page to renew at any time.
      </p>
    </div>
  `;
  const text = `Hi ${safeName}, your sponsored listing "${listingLabel}" expired on ${expiredAtText} and was removed from sponsored placement. Renew to reactivate promoted visibility.`;

  if (provider === "disabled") {
    console.warn("Email provider is disabled by admin setting.");
    return { skipped: true, provider };
  }
  if (provider === "smtp") {
    const mailer = getTransporter();
    if (!mailer) {
      console.warn("SMTP provider selected but not configured. Skipping sponsorship expired email send.");
      return { skipped: true, provider };
    }
    await mailer.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: "Your listing sponsorship has expired",
      text,
      html
    });
    return { skipped: false, provider };
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn("Resend provider selected but not configured. Skipping sponsorship expired email send.");
    return { skipped: true, provider };
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: [toEmail],
    subject: "Your listing sponsorship has expired",
    text,
    html
  });
  return { skipped: false, provider };
}

async function sendNewMatchingListingAlertEmail({
  toEmail,
  fullName,
  listingTitle,
  listingLocation,
  listingType,
  listingPrice,
  listingUrl,
  filterSummary
}) {
  const safeName = String(fullName || "").trim() || "there";
  const safeTitle = String(listingTitle || "").trim() || "New listing";
  const safeLocation = String(listingLocation || "").trim() || "Kenya";
  const safeType = String(listingType || "").trim() || "rent";
  const priceValue = Number(listingPrice);
  const safePrice = Number.isFinite(priceValue)
    ? `KSh ${priceValue.toLocaleString("en-KE")} / month`
    : "Price on request";
  const safeFilterSummary = String(filterSummary || "").trim();
  const safeUrl = String(listingUrl || "").trim();
  const provider = await getConfiguredDeliveryProvider();

  const html = `
    <div style="font-family: Arial, sans-serif; color: #10243e; background: #f6f9fc; padding: 18px;">
      <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e6ecf3;">
        <div style="background: linear-gradient(120deg, #1e3a5f, #2d5a8e); color: #ffffff; padding: 18px 20px;">
          <div style="font-size: 20px; font-weight: 700;">KenReal Estates</div>
          <div style="font-size: 12px; opacity: 0.9;">New listing alert</div>
        </div>
        <div style="padding: 20px;">
          <p style="margin: 0 0 10px;">Hi ${safeName},</p>
          <p style="margin: 0 0 14px;">A new property was uploaded that matches your saved filters.</p>
          <div style="border: 1px solid #d8e2ee; border-radius: 10px; padding: 14px; background: #fbfdff;">
            <p style="margin: 0 0 6px; font-weight: 700;">${safeTitle}</p>
            <p style="margin: 0 0 6px;">${safeLocation} · ${String(safeType).toUpperCase()}</p>
            <p style="margin: 0; color: #1e3a5f; font-weight: 700;">${safePrice}</p>
          </div>
          ${safeFilterSummary ? `<p style="margin: 12px 0 0; font-size: 13px; color: #3b4f6a;">Matched filters: ${safeFilterSummary}</p>` : ""}
          ${safeUrl ? `<a href="${safeUrl}" style="display: inline-block; margin-top: 16px; background: #e8a020; color: #10243e; text-decoration: none; font-weight: 700; padding: 10px 14px; border-radius: 8px;">View listing</a>` : ""}
          <p style="margin: 16px 0 0; font-size: 12px; color: #6d7d93;">
            You can update your listing alert filters anytime from the Listings filter modal.
          </p>
        </div>
      </div>
    </div>
  `;
  const text = [
    `Hi ${safeName},`,
    "",
    "A new property was uploaded that matches your saved filters.",
    `${safeTitle} - ${safeLocation} (${String(safeType).toUpperCase()})`,
    safePrice,
    safeFilterSummary ? `Matched filters: ${safeFilterSummary}` : "",
    safeUrl ? `View listing: ${safeUrl}` : ""
  ].filter(Boolean).join("\n");

  if (provider === "disabled") {
    console.warn("Email provider is disabled by admin setting.");
    return { skipped: true, provider };
  }
  if (provider === "smtp") {
    const mailer = getTransporter();
    if (!mailer) {
      console.warn("SMTP provider selected but not configured. Skipping listing alert email send.");
      return { skipped: true, provider };
    }
    await mailer.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: "New listing match on KenReal Estates",
      text,
      html
    });
    return { skipped: false, provider };
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn("Resend provider selected but not configured. Skipping listing alert email send.");
    return { skipped: true, provider };
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: [toEmail],
    subject: "New listing match on KenReal Estates",
    text,
    html
  });
  return { skipped: false, provider };
}

module.exports = {
  hasMailerConfiguration,
  hasResendConfiguration,
  sendVerificationCodeEmail,
  sendSponsorshipEndingSoonEmail,
  sendSponsorshipExpiredEmail,
  sendNewMatchingListingAlertEmail,
  sendNewMessageNotificationEmail,
  getConfiguredDeliveryProvider
};
