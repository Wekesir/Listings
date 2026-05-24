const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const {
  issueVerificationCodeForEmail,
  verifyCodeForEmail
} = require("../services/auth/emailVerificationService");
const { getConfiguredDeliveryProvider } = require("../services/auth/emailService");

const publicRegistrationAccountTypes = new Set(["lister", "viewer"]);
const allowedSubscriptionTiers = new Set(["standard", "premium"]);
const BCRYPT_ROUNDS = 12;
const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000);
const allowedLogoutReasons = new Set(["manual", "inactivity_timeout", "session_expired", "other"]);
const APP_FRONTEND_URL = String(process.env.APP_FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

function buildSessionUser(user) {
  return {
    id: user.id,
    fullName: user.full_name || user.fullName,
    email: user.email,
    accountType: user.account_type || user.accountType,
    subscriptionTier: user.subscription_tier || user.subscriptionTier || "standard",
    authProvider: user.auth_provider || user.authProvider || "local",
    emailVerified: Boolean(user.email_verified ?? user.emailVerified ?? true),
    createdAt: user.created_at || user.createdAt,
    isBanned: Boolean(user.is_banned || user.isBanned),
    suspendedUntil: user.suspended_until || user.suspendedUntil || null
  };
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    null
  );
}

function parseUserAgent(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  const deviceType =
    /(iphone|ipad|ipod|android|mobile)/.test(ua) ? "mobile" :
    /(tablet)/.test(ua) ? "tablet" :
    /(bot|spider|crawler)/.test(ua) ? "bot" :
    "desktop";

  const platform =
    ua.includes("android") ? "Android" :
    ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios") ? "iOS" :
    ua.includes("windows") ? "Windows" :
    ua.includes("mac os") || ua.includes("macintosh") ? "macOS" :
    ua.includes("linux") ? "Linux" :
    "Unknown";

  const browser =
    ua.includes("edg/") ? "Edge" :
    ua.includes("opr/") || ua.includes("opera") ? "Opera" :
    ua.includes("chrome/") && !ua.includes("edg/") ? "Chrome" :
    ua.includes("firefox/") ? "Firefox" :
    ua.includes("safari/") && !ua.includes("chrome/") ? "Safari" :
    "Unknown";

  const os =
    ua.includes("windows nt 10") ? "Windows 10/11" :
    ua.includes("windows nt 6.3") ? "Windows 8.1" :
    ua.includes("windows nt 6.1") ? "Windows 7" :
    ua.includes("android") ? "Android" :
    ua.includes("iphone os") || ua.includes("cpu iphone os") ? "iOS" :
    ua.includes("mac os x") ? "macOS" :
    ua.includes("linux") ? "Linux" :
    "Unknown";

  return { deviceType, platform, browser, os };
}

function getClientMetadata(req) {
  const userAgent = req.headers["user-agent"] || null;
  const { deviceType, platform, browser, os } = parseUserAgent(userAgent);

  return {
    ipAddress: getClientIp(req),
    userAgent,
    deviceType,
    platform,
    browser,
    os,
    acceptLanguage: req.headers["accept-language"] || null,
    requestPath: req.originalUrl || req.path || null,
    httpMethod: req.method || null
  };
}

function normalizeLogoutReason(reason) {
  const normalized = String(reason || "manual").trim().toLowerCase();
  return allowedLogoutReasons.has(normalized) ? normalized : "other";
}

async function resolveTimedOutAuditUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object") {
    return null;
  }

  const numericId = Number.parseInt(String(rawUser.id), 10);
  const hasValidId = Number.isInteger(numericId) && numericId > 0;
  const email = String(rawUser.email || "").trim().toLowerCase();
  const hasEmail = Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  const accountType = String(rawUser.accountType || "").trim().toLowerCase();
  const safeAccountType = ["admin", "lister", "viewer"].includes(accountType) ? accountType : null;

  if (!hasValidId && !hasEmail) {
    return null;
  }

  try {
    if (hasValidId) {
      const [rows] = await pool.execute(
        `
          SELECT id, email, account_type
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
        [numericId]
      );
      if (rows.length > 0) {
        return {
          id: rows[0].id,
          email: rows[0].email,
          accountType: rows[0].account_type
        };
      }
    }

    if (hasEmail) {
      const [rows] = await pool.execute(
        `
          SELECT id, email, account_type
          FROM users
          WHERE LOWER(email) = ?
          LIMIT 1
        `,
        [email]
      );
      if (rows.length > 0) {
        return {
          id: rows[0].id,
          email: rows[0].email,
          accountType: rows[0].account_type
        };
      }
    }
  } catch (_error) {
    // If lookup fails, still preserve sanitized fallback values for audit context.
  }

  return {
    id: hasValidId ? numericId : null,
    email: hasEmail ? email : null,
    accountType: safeAccountType
  };
}

function normalizeDateFilter(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  const seconds = String(parsed.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeReasonText(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeEmailProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["resend", "smtp", "disabled"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function getUpperBound(value) {
  return value === null ? Number.POSITIVE_INFINITY : Number(value);
}

function rangesOverlap(firstMin, firstMax, secondMin, secondMax) {
  return Number(firstMin) <= getUpperBound(secondMax) && Number(secondMin) <= getUpperBound(firstMax);
}

function getRestrictionState(user) {
  const now = Date.now();
  const isBanned = Boolean(user?.is_banned || user?.isBanned);
  const suspendedUntilRaw = user?.suspended_until || user?.suspendedUntil || null;
  const suspendedUntil = suspendedUntilRaw ? new Date(suspendedUntilRaw) : null;
  const isSuspended = Boolean(
    suspendedUntil && !Number.isNaN(suspendedUntil.getTime()) && suspendedUntil.getTime() > now
  );

  return {
    isBanned,
    isSuspended,
    suspendedUntil: isSuspended ? suspendedUntil.toISOString() : null,
    banReason: user?.ban_reason || user?.banReason || null,
    suspensionReason: user?.suspension_reason || user?.suspensionReason || null
  };
}

function getRestrictionMessage(restrictionState) {
  if (restrictionState.isBanned) {
    return "Your account has been permanently banned. Please contact support.";
  }
  if (restrictionState.isSuspended) {
    const formattedUntil = new Date(restrictionState.suspendedUntil).toLocaleString("en-KE");
    return `Your account is suspended until ${formattedUntil}. Please contact support if you need help.`;
  }
  return null;
}

async function getUserByIdWithRestrictions(userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        full_name,
        email,
        account_type,
        subscription_tier,
        auth_provider,
        email_verified,
        created_at,
        is_banned,
        banned_at,
        ban_reason,
        suspended_until,
        suspension_reason
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [Number(userId)]
  );
  return rows[0] || null;
}

async function createAuditLog({
  req,
  user = null,
  email = null,
  eventType,
  eventReason = null,
  sessionId = null,
  statusCode = null,
  details = null
}) {
  try {
    const metadata = getClientMetadata(req);
    const userId = Number(user?.id);

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
        email || user?.email || null,
        user?.accountType || null,
        eventType,
        eventReason,
        sessionId,
        metadata.ipAddress,
        metadata.userAgent,
        metadata.deviceType,
        metadata.platform,
        metadata.browser,
        metadata.os,
        metadata.acceptLanguage,
        metadata.requestPath,
        metadata.httpMethod,
        Number.isInteger(statusCode) ? statusCode : null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (error) {
    console.error("Failed to write auth audit log:", error.message);
  }
}

function buildFrontendRedirect(pathname, params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return `${APP_FRONTEND_URL}${pathname}${query ? `?${query}` : ""}`;
}

async function createOrLinkOAuthUser(oauthProfile) {
  const provider = String(oauthProfile?.provider || "").trim().toLowerCase();
  const providerSubject = String(oauthProfile?.providerSubject || "").trim();
  const email = String(oauthProfile?.email || "").trim().toLowerCase();
  const fullName = String(oauthProfile?.fullName || "").trim() || "New User";
  const emailVerifiedFromProvider = Boolean(oauthProfile?.emailVerified);

  if (!["google", "apple"].includes(provider) || !providerSubject) {
    return { ok: false, status: 400, message: "Unsupported social provider identity." };
  }
  if (!email) {
    return { ok: false, status: 400, message: "Email was not provided by social provider." };
  }

  const [providerRows] = await pool.execute(
    `
      SELECT
        id,
        full_name,
        email,
        account_type,
        subscription_tier,
        auth_provider,
        provider_subject,
        email_verified,
        created_at,
        is_banned,
        banned_at,
        ban_reason,
        suspended_until,
        suspension_reason
      FROM users
      WHERE auth_provider = ? AND provider_subject = ?
      LIMIT 1
    `,
    [provider, providerSubject]
  );
  if (providerRows.length > 0) {
    return { ok: true, user: providerRows[0], created: false };
  }

  const [emailRows] = await pool.execute(
    `
      SELECT
        id,
        full_name,
        email,
        account_type,
        subscription_tier,
        auth_provider,
        provider_subject,
        email_verified,
        created_at,
        is_banned,
        banned_at,
        ban_reason,
        suspended_until,
        suspension_reason
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [email]
  );

  if (emailRows.length > 0) {
    const existingUser = emailRows[0];
    await pool.execute(
      `
        UPDATE users
        SET
          auth_provider = ?,
          provider_subject = ?,
          email_verified = CASE
            WHEN email_verified = 1 THEN 1
            ELSE ?
          END
        WHERE id = ?
      `,
      [provider, providerSubject, emailVerifiedFromProvider ? 1 : 0, existingUser.id]
    );
    const [updatedRows] = await pool.execute(
      `
        SELECT
          id,
          full_name,
          email,
          account_type,
          subscription_tier,
          auth_provider,
          provider_subject,
          email_verified,
          created_at,
          is_banned,
          banned_at,
          ban_reason,
          suspended_until,
          suspension_reason
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [existingUser.id]
    );
    return { ok: true, user: updatedRows[0], created: false };
  }

  // Social users default to viewer until they choose to list.
  const placeholderPassword = await bcrypt.hash(`oauth:${provider}:${providerSubject}`, BCRYPT_ROUNDS);
  const [insertResult] = await pool.execute(
    `
      INSERT INTO users (
        full_name,
        email,
        password,
        account_type,
        subscription_tier,
        auth_provider,
        provider_subject,
        email_verified
      )
      VALUES (?, ?, ?, 'viewer', 'standard', ?, ?, ?)
    `,
    [fullName, email, placeholderPassword, provider, providerSubject, emailVerifiedFromProvider ? 1 : 0]
  );
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        full_name,
        email,
        account_type,
        subscription_tier,
        auth_provider,
        provider_subject,
        email_verified,
        created_at,
        is_banned,
        banned_at,
        ban_reason,
        suspended_until,
        suspension_reason
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [insertResult.insertId]
  );
  return { ok: true, user: rows[0], created: true };
}

const registerUser = async (req, res) => {
  const { fullName, email, password, accountType, subscriptionTier } = req.body || {};

  try {
    if (!fullName || !email || !password || !accountType) {
      return res.status(400).json({
        message: "Full name, email, password, and account type are required"
      });
    }

    if (accountType === "admin") {
      return res.status(403).json({
        message: "Admin accounts can only be created by an authenticated admin."
      });
    }

    if (!publicRegistrationAccountTypes.has(accountType)) {
      return res.status(400).json({
        message: "Account type must be one of 'lister' or 'viewer'"
      });
    }

    const normalizedTier = String(subscriptionTier || "standard").trim().toLowerCase();
    if (!allowedSubscriptionTiers.has(normalizedTier)) {
      return res.status(400).json({
        message: "Subscription tier must be either 'standard' or 'premium'"
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(fullName).trim();
    const normalizedPassword = String(password);

    if (!trimmedName) {
      return res.status(400).json({
        message: "Full name cannot be empty"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address"
      });
    }

    if (normalizedPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters"
      });
    }

    const hashedPassword = await bcrypt.hash(normalizedPassword, BCRYPT_ROUNDS);

    const [existingRows] = await pool.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        message: "An account with this email already exists"
      });
    }

    const [result] = await pool.execute(
      `
        INSERT INTO users (
          full_name,
          email,
          password,
          account_type,
          subscription_tier,
          auth_provider,
          email_verified
        )
        VALUES (?, ?, ?, ?, ?, 'local', 0)
      `,
      [trimmedName, normalizedEmail, hashedPassword, accountType, normalizedTier]
    );

    const verificationResult = await issueVerificationCodeForEmail(normalizedEmail, { forceSend: true });
    const verificationMessage = verificationResult.ok
      ? "We've sent a verification code to your email."
      : "Account created. Please request a verification code from the verify screen.";

    return res.status(201).json({
      message: "Account created successfully. Email verification is required before login.",
      verificationRequired: true,
      verificationMessage,
      user: {
        id: result.insertId,
        fullName: trimmedName,
        email: normalizedEmail,
        accountType,
        subscriptionTier: normalizedTier,
        authProvider: "local",
        emailVerified: false,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create account"
    });
  }
};

const createAdminUser = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({
      message: "Session expired. Please log in again."
    });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({
      message: "Only admin accounts can create other admin users"
    });
  }

  const { fullName, email, password } = req.body || {};

  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({
        message: "Full name, email, and password are required"
      });
    }

    const trimmedName = String(fullName).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPassword = String(password);

    if (!trimmedName) {
      return res.status(400).json({
        message: "Full name cannot be empty"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address"
      });
    }

    if (normalizedPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters"
      });
    }

    const [existingRows] = await pool.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({
        message: "An account with this email already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(normalizedPassword, BCRYPT_ROUNDS);
    const [result] = await pool.execute(
      `
        INSERT INTO users (
          full_name,
          email,
          password,
          account_type,
          subscription_tier,
          auth_provider,
          email_verified
        )
        VALUES (?, ?, ?, 'admin', 'standard', 'local', 1)
      `,
      [trimmedName, normalizedEmail, hashedPassword]
    );

    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "admin_user_created",
      eventReason: "admin_created_admin_user",
      sessionId: req.sessionID || null,
      statusCode: 201,
      details: {
        createdAdminUserId: result.insertId,
        createdAdminEmail: normalizedEmail
      }
    });

    return res.status(201).json({
      message: "Admin account created successfully",
      user: {
        id: result.insertId,
        fullName: trimmedName,
        email: normalizedEmail,
        accountType: "admin",
        subscriptionTier: "standard",
        createdAt: new Date().toISOString()
      }
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Failed to create admin account"
    });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();

  try {
    if (!email || !password) {
      await createAuditLog({
        req,
        email: normalizedEmail || null,
        eventType: "login_failed",
        eventReason: "missing_credentials",
        sessionId: req.sessionID || null,
        statusCode: 400
      });
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const [rows] = await pool.execute(
      `
        SELECT
          id,
          full_name,
          email,
          password,
          account_type,
          subscription_tier,
          auth_provider,
          email_verified,
          created_at,
          is_banned,
          banned_at,
          ban_reason,
          suspended_until,
          suspension_reason
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
      [normalizedEmail]
    );

    const user = rows[0];

    if (!user) {
      await createAuditLog({
        req,
        email: normalizedEmail,
        eventType: "login_failed",
        eventReason: "user_not_found",
        sessionId: req.sessionID || null,
        statusCode: 401
      });
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const submittedPassword = String(password);
    let passwordMatches = false;

    if (isBcryptHash(user.password)) {
      passwordMatches = await bcrypt.compare(submittedPassword, user.password);
    } else {
      // Backward compatibility for older plaintext records.
      passwordMatches = user.password === submittedPassword;
      if (passwordMatches) {
        const upgradedHash = await bcrypt.hash(submittedPassword, BCRYPT_ROUNDS);
        await pool.execute("UPDATE users SET password = ? WHERE id = ?", [upgradedHash, user.id]);
      }
    }

    if (!passwordMatches) {
      await createAuditLog({
        req,
        email: normalizedEmail,
        eventType: "login_failed",
        eventReason: "invalid_password",
        sessionId: req.sessionID || null,
        statusCode: 401
      });
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    if (!Boolean(user.email_verified)) {
      await createAuditLog({
        req,
        email: normalizedEmail,
        user,
        eventType: "login_failed",
        eventReason: "email_not_verified",
        sessionId: req.sessionID || null,
        statusCode: 403
      });
      return res.status(403).json({
        message: "Please verify your email before logging in.",
        verificationRequired: true,
        email: normalizedEmail
      });
    }

    const restrictionState = getRestrictionState(user);
    const restrictionMessage = getRestrictionMessage(restrictionState);
    if (restrictionMessage) {
      await createAuditLog({
        req,
        email: normalizedEmail,
        user,
        eventType: "login_failed",
        eventReason: restrictionState.isBanned ? "account_banned" : "account_suspended",
        sessionId: req.sessionID || null,
        statusCode: 403,
        details: {
          banReason: restrictionState.banReason,
          suspensionReason: restrictionState.suspensionReason,
          suspendedUntil: restrictionState.suspendedUntil
        }
      });
      return res.status(403).json({
        message: restrictionMessage
      });
    }

    const sessionUser = buildSessionUser(user);
    req.session.user = sessionUser;
    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "login_success",
      eventReason: "credentials_verified",
      sessionId: req.sessionID || null,
      statusCode: 200
    });

    return res.status(200).json({
      message: "Login successful",
      user: sessionUser,
      session: {
        timeoutMs: SESSION_IDLE_TIMEOUT_MS
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to log in"
    });
  }
};

const verifyEmailCode = async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  try {
    const result = await verifyCodeForEmail(email, code);
    await createAuditLog({
      req,
      email: email || null,
      eventType: result.ok ? "email_verification_success" : "email_verification_failed",
      eventReason: result.ok ? "code_verified" : "invalid_or_expired_code",
      sessionId: req.sessionID || null,
      statusCode: result.status
    });
    return res.status(result.status).json({
      message: result.message,
      verified: result.ok
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Failed to verify email code"
    });
  }
};

const resendVerificationCode = async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({
      message: "Email is required"
    });
  }

  try {
    const result = await issueVerificationCodeForEmail(email);
    await createAuditLog({
      req,
      email,
      eventType: result.ok ? "email_verification_sent" : "email_verification_send_failed",
      eventReason: result.ok ? "resend_requested" : "resend_blocked",
      sessionId: req.sessionID || null,
      statusCode: result.status
    });
    return res.status(result.status).json({
      message: result.message,
      verificationRequired: true
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Failed to resend verification code"
    });
  }
};

const handleOAuthCallback = async (req, res) => {
  const providerProfile = req.user;
  try {
    if (!providerProfile) {
      return res.redirect(
        buildFrontendRedirect("/register", {
          oauthError: "missing_profile"
        })
      );
    }

    const upsertResult = await createOrLinkOAuthUser(providerProfile);
    if (!upsertResult.ok || !upsertResult.user) {
      return res.redirect(
        buildFrontendRedirect("/register", {
          oauthError: "account_link_failed"
        })
      );
    }

    const resolvedUser = upsertResult.user;
    const restrictionState = getRestrictionState(resolvedUser);
    const restrictionMessage = getRestrictionMessage(restrictionState);
    if (restrictionMessage) {
      await createAuditLog({
        req,
        user: resolvedUser,
        email: resolvedUser.email,
        eventType: "oauth_login_failed",
        eventReason: restrictionState.isBanned ? "account_banned" : "account_suspended",
        sessionId: req.sessionID || null,
        statusCode: 403
      });
      return res.redirect(
        buildFrontendRedirect("/login", {
          oauthError: "account_restricted"
        })
      );
    }

    if (!Boolean(resolvedUser.email_verified)) {
      await issueVerificationCodeForEmail(resolvedUser.email);
      await createAuditLog({
        req,
        user: resolvedUser,
        email: resolvedUser.email,
        eventType: "oauth_signup_pending_verification",
        eventReason: "email_verification_required",
        sessionId: req.sessionID || null,
        statusCode: 200
      });
      return res.redirect(
        buildFrontendRedirect("/verify-email", {
          email: resolvedUser.email,
          source: providerProfile.provider || "social"
        })
      );
    }

    const sessionUser = buildSessionUser(resolvedUser);
    req.session.user = sessionUser;
    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "oauth_login_success",
      eventReason: `${providerProfile.provider || "social"}_oauth_verified`,
      sessionId: req.sessionID || null,
      statusCode: 200
    });
    return res.redirect(
      buildFrontendRedirect("/login", {
        oauthSuccess: "1"
      })
    );
  } catch (_error) {
    return res.redirect(
      buildFrontendRedirect("/register", {
        oauthError: "callback_failed"
      })
    );
  }
};

const handleOAuthFailureRedirect = (req, res) => {
  const provider = String(req.query?.provider || "").trim().toLowerCase();
  return res.redirect(
    buildFrontendRedirect("/register", {
      oauthError: provider ? `${provider}_failed` : "oauth_failed"
    })
  );
};

const updateProfile = async (req, res) => {
  const { userId, fullName, email } = req.body || {};

  try {
    if (!req.session?.user) {
      return res.status(401).json({
        message: "Session expired. Please log in again."
      });
    }

    const currentUser = await getUserByIdWithRestrictions(req.session.user.id);
    if (!currentUser) {
      req.session.destroy(() => {});
      return res.status(401).json({
        message: "Session expired. Please log in again."
      });
    }

    const restrictionState = getRestrictionState(currentUser);
    const restrictionMessage = getRestrictionMessage(restrictionState);
    if (restrictionMessage) {
      req.session.destroy(() => {});
      return res.status(403).json({
        message: restrictionMessage
      });
    }

    if (!userId || !fullName || !email) {
      return res.status(400).json({
        message: "User ID, full name, and email are required"
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(fullName).trim();
    const numericUserId = Number(userId);
    const sessionUserId = Number(req.session.user.id);

    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return res.status(400).json({
        message: "Invalid user ID"
      });
    }

    if (numericUserId !== sessionUserId) {
      return res.status(403).json({
        message: "You are not allowed to update this profile"
      });
    }

    if (!trimmedName) {
      return res.status(400).json({
        message: "Full name cannot be empty"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address"
      });
    }

    const [existingRows] = await pool.execute(
      "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
      [normalizedEmail, numericUserId]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({
        message: "Another account is already using this email"
      });
    }

    const [updateResult] = await pool.execute(
      `
        UPDATE users
        SET full_name = ?, email = ?
        WHERE id = ?
      `,
      [trimmedName, normalizedEmail, numericUserId]
    );

    if (!updateResult.affectedRows) {
      return res.status(404).json({
        message: "User account not found"
      });
    }

    const [rows] = await pool.execute(
      `
        SELECT id, full_name, email, account_type, subscription_tier, created_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [numericUserId]
    );
    const user = rows[0];

    const updatedUser = buildSessionUser(user);
    req.session.user = updatedUser;

    return res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Failed to update profile"
    });
  }
};

const getSessionUser = (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({
      message: "No active session"
    });
  }

  return getUserByIdWithRestrictions(sessionUser.id)
    .then((dbUser) => {
      if (!dbUser) {
        req.session.destroy(() => {});
        return res.status(401).json({
          message: "Session expired. Please log in again."
        });
      }

      const restrictionState = getRestrictionState(dbUser);
      const restrictionMessage = getRestrictionMessage(restrictionState);
      if (restrictionMessage) {
        req.session.destroy(() => {});
        return res.status(403).json({
          message: restrictionMessage
        });
      }

      const refreshedSessionUser = buildSessionUser(dbUser);
      req.session.user = refreshedSessionUser;
      return res.status(200).json({
        user: refreshedSessionUser,
        session: {
          timeoutMs: SESSION_IDLE_TIMEOUT_MS
        }
      });
    })
    .catch(() => res.status(500).json({
      message: "Failed to validate active session"
    }));
};

const logoutUser = async (req, res) => {
  const logoutReason = normalizeLogoutReason(req.body?.reason);
  const timedOutAuditUser = logoutReason === "inactivity_timeout"
    ? await resolveTimedOutAuditUser(req.body?.timedOutUser)
    : null;
  const sessionUser = req.session?.user || timedOutAuditUser || null;
  const sessionId = req.sessionID || null;
  const timeoutAuditDetails = logoutReason === "inactivity_timeout"
    ? {
        timeoutSource: "client_idle_detector",
        fallbackIdentityUsed: Boolean(timedOutAuditUser && !req.session?.user)
      }
    : null;

  if (!req.session) {
    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser?.email || null,
      eventType: "logout",
      eventReason: `${logoutReason}_no_session`,
      sessionId,
      statusCode: 200,
      details: timeoutAuditDetails
    });
    return res.status(200).json({
      message: "Logged out successfully"
    });
  }

  try {
    await new Promise((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser?.email || null,
      eventType: "logout_failed",
      eventReason: "session_destroy_error",
      sessionId,
      statusCode: 500,
      details: {
        errorMessage: error.message,
        ...(timeoutAuditDetails || {})
      }
    });
    return res.status(500).json({
      message: "Failed to log out"
    });
  }

  res.clearCookie("connect.sid");
  await createAuditLog({
    req,
    user: sessionUser,
    email: sessionUser?.email || null,
    eventType: "logout",
    eventReason: logoutReason,
    sessionId,
    statusCode: 200,
    details: timeoutAuditDetails
  });
  return res.status(200).json({
    message: "Logged out successfully"
  });
};

const getAuthAuditLogs = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({
      message: "Session expired. Please log in again."
    });
  }

  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({
      message: "Only admin accounts can view authentication audit logs"
    });
  }

  const {
    eventType = "",
    eventReason = "",
    email = "",
    ipAddress = "",
    userId = "",
    sessionId = "",
    unknownIpOnly = "",
    fromDate = "",
    toDate = "",
    page = "1",
    limit = "50"
  } = req.query || {};

  const numericPage = Number.parseInt(String(page), 10);
  const numericLimit = Number.parseInt(String(limit), 10);
  const safePage = Number.isInteger(numericPage) && numericPage > 0 ? numericPage : 1;
  const safeLimit = Number.isInteger(numericLimit) && numericLimit > 0
    ? Math.min(numericLimit, 100)
    : 50;
  const offset = Number((safePage - 1) * safeLimit);

  const whereParts = [];
  const whereValues = [];

  if (eventType) {
    whereParts.push("event_type = ?");
    whereValues.push(String(eventType).trim());
  }
  if (eventReason) {
    whereParts.push("event_reason = ?");
    whereValues.push(String(eventReason).trim());
  }
  if (email) {
    whereParts.push("email LIKE ?");
    whereValues.push(`%${String(email).trim().toLowerCase()}%`);
  }
  if (ipAddress) {
    whereParts.push("ip_address LIKE ?");
    whereValues.push(`%${String(ipAddress).trim()}%`);
  }
  if (sessionId) {
    whereParts.push("session_id LIKE ?");
    whereValues.push(`%${String(sessionId).trim()}%`);
  }
  const normalizedUnknownIpOnly = String(unknownIpOnly).trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalizedUnknownIpOnly)) {
    whereParts.push("(ip_address IS NULL OR ip_address = '' OR ip_address = '::1')");
  }
  if (userId) {
    const numericUserId = Number.parseInt(String(userId), 10);
    if (Number.isInteger(numericUserId) && numericUserId > 0) {
      whereParts.push("user_id = ?");
      whereValues.push(numericUserId);
    }
  }
  if (fromDate) {
    const normalizedFromDate = normalizeDateFilter(fromDate);
    if (!normalizedFromDate) {
      return res.status(400).json({
        message: "Invalid fromDate value"
      });
    }
    whereParts.push("created_at >= ?");
    whereValues.push(normalizedFromDate);
  }
  if (toDate) {
    const normalizedToDate = normalizeDateFilter(toDate);
    if (!normalizedToDate) {
      return res.status(400).json({
        message: "Invalid toDate value"
      });
    }
    whereParts.push("created_at <= ?");
    whereValues.push(normalizedToDate);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  try {
    const [rows] = await pool.execute(
      `
        SELECT
          id,
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
          details,
          created_at
        FROM auth_audit_logs
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ${safeLimit}
        OFFSET ${offset}
      `,
      [...whereValues]
    );

    const [countRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total
        FROM auth_audit_logs
        ${whereClause}
      `,
      [...whereValues]
    );

    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));

    return res.status(200).json({
      data: rows,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages
      }
    });
  } catch (error) {
    console.error("Failed to fetch auth audit logs:", error.message);
    return res.status(500).json({
      message: "Failed to fetch authentication audit logs"
    });
  }
};

const deleteAuthAuditLogs = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({
      message: "Session expired. Please log in again."
    });
  }

  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({
      message: "Only admin accounts can delete authentication audit logs"
    });
  }

  const scope = String(req.body?.scope || "").trim().toLowerCase();
  const supportedScopes = new Set(["period", "user", "all"]);
  if (!supportedScopes.has(scope)) {
    return res.status(400).json({
      message: "scope must be one of: period, user, all"
    });
  }

  try {
    let whereClause = "";
    const whereValues = [];

    if (scope === "period") {
      const fromDate = normalizeDateFilter(req.body?.fromDate);
      const toDate = normalizeDateFilter(req.body?.toDate);

      if (!fromDate && !toDate) {
        return res.status(400).json({
          message: "Provide at least one date (fromDate or toDate) for period deletion"
        });
      }

      const whereParts = [];
      if (fromDate) {
        whereParts.push("created_at >= ?");
        whereValues.push(fromDate);
      }
      if (toDate) {
        whereParts.push("created_at <= ?");
        whereValues.push(toDate);
      }
      whereClause = `WHERE ${whereParts.join(" AND ")}`;
    }

    if (scope === "user") {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({
          message: "Provide a user email for user-scoped deletion"
        });
      }
      whereClause = "WHERE LOWER(email) = ?";
      whereValues.push(email);
    }

    const [result] = await pool.execute(
      `
        DELETE FROM auth_audit_logs
        ${whereClause}
      `,
      whereValues
    );

    const deletedCount = Number(result?.affectedRows || 0);
    return res.status(200).json({
      message: `Deleted ${deletedCount} audit log record${deletedCount === 1 ? "" : "s"}.`,
      deletedCount
    });
  } catch (error) {
    console.error("Failed to delete auth audit logs:", error.message);
    return res.status(500).json({
      message: "Failed to delete authentication audit logs"
    });
  }
};

const getManageableUsers = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can manage users" });
  }

  try {
    const [rows] = await pool.execute(
      `
        SELECT
          id,
          full_name,
          email,
          account_type,
          subscription_tier,
          auth_provider,
          email_verified,
          created_at,
          is_banned,
          banned_at,
          ban_reason,
          suspended_until,
          suspension_reason
        FROM users
        ORDER BY created_at DESC, id DESC
      `
    );

    return res.status(200).json({
      data: rows.map((row) => {
        const restrictionState = getRestrictionState(row);
        return {
          id: row.id,
          fullName: row.full_name,
          email: row.email,
          accountType: row.account_type,
          subscriptionTier: row.subscription_tier,
          authProvider: row.auth_provider || "local",
          emailVerified: Boolean(row.email_verified),
          createdAt: row.created_at,
          isBanned: restrictionState.isBanned,
          bannedAt: row.banned_at || null,
          banReason: row.ban_reason || null,
          isSuspended: restrictionState.isSuspended,
          suspendedUntil: restrictionState.suspendedUntil,
          suspensionReason: row.suspension_reason || null
        };
      })
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch users"
    });
  }
};

const suspendUserAccount = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can suspend users" });
  }

  const targetUserId = Number.parseInt(String(req.params.userId), 10);
  const durationHours = Number(req.body?.durationHours);
  const reason = normalizeReasonText(req.body?.reason, "admin_suspension");

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return res.status(400).json({ message: "durationHours must be a positive number" });
  }
  if (targetUserId === Number(sessionUser.id)) {
    return res.status(400).json({ message: "You cannot suspend your own admin account" });
  }

  try {
    const targetUser = await getUserByIdWithRestrictions(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.account_type === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be suspended" });
    }

    const durationMs = Math.round(durationHours * 60 * 60 * 1000);
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

    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "user_restriction_updated",
      eventReason: "admin_suspend_user",
      sessionId: req.sessionID || null,
      statusCode: 200,
      details: {
        targetUserId,
        targetEmail: targetUser.email,
        durationHours,
        suspendedUntil: suspendedUntilDate.toISOString(),
        reason
      }
    });

    return res.status(200).json({
      message: `User suspended until ${suspendedUntilDate.toLocaleString("en-KE")}`
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to suspend user"
    });
  }
};

const banUserAccount = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can ban users" });
  }

  const targetUserId = Number.parseInt(String(req.params.userId), 10);
  const reason = normalizeReasonText(req.body?.reason, "admin_ban");
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  if (targetUserId === Number(sessionUser.id)) {
    return res.status(400).json({ message: "You cannot ban your own admin account" });
  }

  try {
    const targetUser = await getUserByIdWithRestrictions(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.account_type === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be banned" });
    }

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

    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "user_restriction_updated",
      eventReason: "admin_ban_user",
      sessionId: req.sessionID || null,
      statusCode: 200,
      details: {
        targetUserId,
        targetEmail: targetUser.email,
        reason
      }
    });

    return res.status(200).json({
      message: "User has been permanently banned"
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to ban user"
    });
  }
};

const clearUserRestrictions = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can update restrictions" });
  }

  const targetUserId = Number.parseInt(String(req.params.userId), 10);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  try {
    const targetUser = await getUserByIdWithRestrictions(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await pool.execute(
      `
        UPDATE users
        SET
          is_banned = 0,
          banned_at = NULL,
          ban_reason = NULL,
          suspended_until = NULL,
          suspension_reason = NULL
        WHERE id = ?
      `,
      [targetUserId]
    );

    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "user_restriction_updated",
      eventReason: "admin_clear_user_restrictions",
      sessionId: req.sessionID || null,
      statusCode: 200,
      details: {
        targetUserId,
        targetEmail: targetUser.email
      }
    });

    return res.status(200).json({
      message: "User restrictions have been removed"
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update user restrictions"
    });
  }
};

const getEmailDeliveryConfiguration = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can view email delivery configuration" });
  }

  try {
    const provider = await getConfiguredDeliveryProvider();
    return res.status(200).json({
      provider,
      availableProviders: [
        { id: "resend", label: "Resend (recommended for MVP)" },
        { id: "smtp", label: "SMTP (custom mail server)" },
        { id: "disabled", label: "Disabled (no outbound email)" }
      ]
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to load email delivery configuration" });
  }
};

const updateEmailDeliveryConfiguration = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can update email delivery configuration" });
  }

  const provider = normalizeEmailProvider(req.body?.provider);
  if (!provider) {
    return res.status(400).json({
      message: "provider must be one of: resend, smtp, disabled"
    });
  }

  try {
    await pool.execute(
      `
        INSERT INTO system_settings (setting_key, setting_value)
        VALUES ('email_delivery_provider', JSON_OBJECT('provider', ?))
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `,
      [provider]
    );

    await createAuditLog({
      req,
      user: sessionUser,
      email: sessionUser.email,
      eventType: "email_delivery_config_updated",
      eventReason: "admin_updated_email_provider",
      sessionId: req.sessionID || null,
      statusCode: 200,
      details: {
        provider
      }
    });

    return res.status(200).json({
      message: `Email delivery provider set to ${provider}.`,
      provider
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to update email delivery configuration" });
  }
};

const getListingPricingConfiguration = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can view listing pricing configuration" });
  }

  try {
    const [rulesRows] = await pool.execute(
      `
        SELECT
          id,
          listing_type AS listingType,
          min_property_value AS minPropertyValue,
          max_property_value AS maxPropertyValue,
          monthly_fee_usd AS monthlyFeeUsd,
          is_active AS isActive
        FROM listing_pricing_rules
        ORDER BY listing_type ASC, min_property_value ASC, id ASC
      `
    );

    const [discountRows] = await pool.execute(
      `
        SELECT
          id,
          min_months AS minMonths,
          max_months AS maxMonths,
          discount_percent AS discountPercent,
          is_active AS isActive
        FROM listing_duration_discounts
        ORDER BY min_months ASC, id ASC
      `
    );

    return res.status(200).json({
      rules: rulesRows,
      discounts: discountRows
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to load listing pricing configuration" });
  }
};

const updateListingPricingConfiguration = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (sessionUser.accountType !== "admin") {
    return res.status(403).json({ message: "Only admin accounts can update listing pricing configuration" });
  }

  const incomingRules = Array.isArray(req.body?.rules) ? req.body.rules : null;
  const incomingDiscounts = Array.isArray(req.body?.discounts) ? req.body.discounts : null;

  if (!incomingRules || !incomingDiscounts || incomingRules.length === 0 || incomingDiscounts.length === 0) {
    return res.status(400).json({ message: "rules and discounts arrays are required" });
  }

  const normalizedRules = [];
  for (const item of incomingRules) {
    const listingType = String(item?.listingType || "").trim().toLowerCase();
    const minPropertyValue = Number(item?.minPropertyValue);
    const maxPropertyValueRaw = item?.maxPropertyValue;
    const maxPropertyValue = maxPropertyValueRaw === null || maxPropertyValueRaw === ""
      ? null
      : Number(maxPropertyValueRaw);
    const monthlyFeeUsd = Number(item?.monthlyFeeUsd);
    const isActive = item?.isActive === undefined ? true : Boolean(item?.isActive);

    if (!["rent", "lease"].includes(listingType)) {
      return res.status(400).json({ message: "Each rule listingType must be either rent or lease" });
    }
    if (!Number.isFinite(minPropertyValue) || minPropertyValue < 0) {
      return res.status(400).json({ message: "Each rule minPropertyValue must be a non-negative number" });
    }
    if (maxPropertyValue !== null && (!Number.isFinite(maxPropertyValue) || maxPropertyValue < minPropertyValue)) {
      return res.status(400).json({ message: "Each rule maxPropertyValue must be null or >= minPropertyValue" });
    }
    if (!Number.isFinite(monthlyFeeUsd) || monthlyFeeUsd <= 0) {
      return res.status(400).json({ message: "Each rule monthlyFeeUsd must be a positive number" });
    }

    normalizedRules.push({
      listingType,
      minPropertyValue,
      maxPropertyValue,
      monthlyFeeUsd,
      isActive
    });
  }

  const activeRulesByType = {
    rent: normalizedRules.filter((item) => item.isActive && item.listingType === "rent"),
    lease: normalizedRules.filter((item) => item.isActive && item.listingType === "lease")
  };

  if (activeRulesByType.rent.length === 0 || activeRulesByType.lease.length === 0) {
    return res.status(400).json({
      message: "At least one active pricing band is required for both rent and lease."
    });
  }

  for (const listingType of ["rent", "lease"]) {
    const rulesForType = activeRulesByType[listingType];
    for (let index = 0; index < rulesForType.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < rulesForType.length; compareIndex += 1) {
        const first = rulesForType[index];
        const second = rulesForType[compareIndex];
        if (rangesOverlap(
          first.minPropertyValue,
          first.maxPropertyValue,
          second.minPropertyValue,
          second.maxPropertyValue
        )) {
          return res.status(400).json({
            message: `Overlapping active ${listingType} pricing bands detected. Update ranges so they do not overlap.`
          });
        }
      }
    }
  }

  const normalizedDiscounts = [];
  for (const item of incomingDiscounts) {
    const minMonths = Number.parseInt(String(item?.minMonths), 10);
    const maxMonthsRaw = item?.maxMonths;
    const maxMonths = maxMonthsRaw === null || maxMonthsRaw === ""
      ? null
      : Number.parseInt(String(maxMonthsRaw), 10);
    const discountPercent = Number(item?.discountPercent);
    const isActive = item?.isActive === undefined ? true : Boolean(item?.isActive);

    if (!Number.isInteger(minMonths) || minMonths <= 0) {
      return res.status(400).json({ message: "Each discount minMonths must be a positive integer" });
    }
    if (maxMonths !== null && (!Number.isInteger(maxMonths) || maxMonths < minMonths)) {
      return res.status(400).json({ message: "Each discount maxMonths must be null or >= minMonths" });
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      return res.status(400).json({ message: "Each discount discountPercent must be between 0 and 100" });
    }

    normalizedDiscounts.push({
      minMonths,
      maxMonths,
      discountPercent,
      isActive
    });
  }

  const activeDiscounts = normalizedDiscounts.filter((item) => item.isActive);
  if (activeDiscounts.length === 0) {
    return res.status(400).json({ message: "At least one active duration discount band is required." });
  }

  for (let index = 0; index < activeDiscounts.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < activeDiscounts.length; compareIndex += 1) {
      const first = activeDiscounts[index];
      const second = activeDiscounts[compareIndex];
      if (rangesOverlap(first.minMonths, first.maxMonths, second.minMonths, second.maxMonths)) {
        return res.status(400).json({
          message: "Overlapping active duration discount bands detected. Update month ranges so they do not overlap."
        });
      }
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute("DELETE FROM listing_pricing_rules");
    for (const rule of normalizedRules) {
      await connection.execute(
        `
          INSERT INTO listing_pricing_rules (
            listing_type,
            min_property_value,
            max_property_value,
            monthly_fee_usd,
            is_active
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          rule.listingType,
          rule.minPropertyValue,
          rule.maxPropertyValue,
          rule.monthlyFeeUsd,
          rule.isActive ? 1 : 0
        ]
      );
    }

    await connection.execute("DELETE FROM listing_duration_discounts");
    for (const discount of normalizedDiscounts) {
      await connection.execute(
        `
          INSERT INTO listing_duration_discounts (
            min_months,
            max_months,
            discount_percent,
            is_active
          )
          VALUES (?, ?, ?, ?)
        `,
        [
          discount.minMonths,
          discount.maxMonths,
          discount.discountPercent,
          discount.isActive ? 1 : 0
        ]
      );
    }

    await connection.commit();
  } catch (_error) {
    await connection.rollback();
    connection.release();
    return res.status(500).json({ message: "Failed to update listing pricing configuration" });
  }
  connection.release();

  await createAuditLog({
    req,
    user: sessionUser,
    email: sessionUser.email,
    eventType: "listing_pricing_updated",
    eventReason: "admin_updated_listing_pricing",
    sessionId: req.sessionID || null,
    statusCode: 200,
    details: {
      ruleCount: normalizedRules.length,
      discountCount: normalizedDiscounts.length
    }
  });

  return getListingPricingConfiguration(req, res);
};

module.exports = {
  registerUser,
  createAdminUser,
  loginUser,
  verifyEmailCode,
  resendVerificationCode,
  handleOAuthCallback,
  handleOAuthFailureRedirect,
  updateProfile,
  getSessionUser,
  logoutUser,
  getAuthAuditLogs,
  deleteAuthAuditLogs,
  getListingPricingConfiguration,
  updateListingPricingConfiguration,
  getManageableUsers,
  suspendUserAccount,
  banUserAccount,
  clearUserRestrictions,
  getEmailDeliveryConfiguration,
  updateEmailDeliveryConfiguration
};
