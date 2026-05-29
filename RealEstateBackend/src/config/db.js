const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

function readBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readStringEnv(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized || fallback;
}

const SEED_ADMIN_ENABLED = readBooleanEnv(process.env.SEED_ADMIN_ENABLED, true);
const SEED_DEMO_LISTER_ENABLED = readBooleanEnv(process.env.SEED_DEMO_LISTER_ENABLED, true);
const SEEDED_ADMIN = {
  fullName: readStringEnv(process.env.SEED_ADMIN_FULL_NAME, "Kennedy Wekesir"),
  email: readStringEnv(process.env.SEED_ADMIN_EMAIL, "kenwekesir@gmail.com").toLowerCase(),
  phone: readStringEnv(process.env.SEED_ADMIN_PHONE, "0710595755"),
  password: readStringEnv(process.env.SEED_ADMIN_PASSWORD, "@Wekesir1"),
  accountType: "admin",
  subscriptionTier: ["standard", "premium"].includes(
    readStringEnv(process.env.SEED_ADMIN_SUBSCRIPTION_TIER, "premium").toLowerCase()
  )
    ? readStringEnv(process.env.SEED_ADMIN_SUBSCRIPTION_TIER, "premium").toLowerCase()
    : "premium"
};
const SEEDED_DEMO_LISTER = {
  fullName: readStringEnv(process.env.SEED_DEMO_LISTER_FULL_NAME, "Demo Lister"),
  email: readStringEnv(process.env.SEED_DEMO_LISTER_EMAIL, "demo-lister@kenreal.local").toLowerCase(),
  phone: readStringEnv(process.env.SEED_DEMO_LISTER_PHONE, "0700000001"),
  password: readStringEnv(process.env.SEED_DEMO_LISTER_PASSWORD, "@DemoLister1"),
  accountType: "lister",
  subscriptionTier: ["standard", "premium"].includes(
    readStringEnv(process.env.SEED_DEMO_LISTER_SUBSCRIPTION_TIER, "standard").toLowerCase()
  )
    ? readStringEnv(process.env.SEED_DEMO_LISTER_SUBSCRIPTION_TIER, "standard").toLowerCase()
    : "standard"
};
const BCRYPT_ROUNDS = 12;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "realestate",
  waitForConnections: true,
  connectionLimit: 10
});

async function waitForDatabase(maxAttempts = 15, retryDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      console.log("Database connection established");
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      console.log(
        `Database connection attempt ${attempt}/${maxAttempts} failed: ${error.message}`
      );

      if (isLastAttempt) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(20) NULL,
      country_code CHAR(2) NOT NULL DEFAULT 'KE',
      password VARCHAR(255) NOT NULL,
      account_type ENUM('lister', 'viewer', 'admin', 'employee') NOT NULL,
      employee_role_id BIGINT NULL,
      subscription_tier ENUM('standard', 'premium') NOT NULL DEFAULT 'standard',
      auth_provider ENUM('local', 'google', 'apple') NOT NULL DEFAULT 'local',
      provider_subject VARCHAR(255) NULL,
      email_verified TINYINT(1) NOT NULL DEFAULT 0,
      email_verification_code_hash VARCHAR(255) NULL,
      email_verification_expires_at DATETIME NULL,
      email_verification_attempts INT NOT NULL DEFAULT 0,
      last_verification_sent_at DATETIME NULL,
      is_banned TINYINT(1) NOT NULL DEFAULT 0,
      banned_at DATETIME NULL,
      ban_reason VARCHAR(255) NULL,
      suspended_until DATETIME NULL,
      suspension_reason VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [subscriptionTierColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'subscription_tier'
  `);

  const hasSubscriptionTierColumn = Number(subscriptionTierColumnRows?.[0]?.count || 0) > 0;
  if (!hasSubscriptionTierColumn) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN subscription_tier ENUM('standard', 'premium') NOT NULL DEFAULT 'standard'
    `);
  }

  const [accountTypeColumnRows] = await pool.query(`
    SELECT COLUMN_TYPE AS columnType
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'account_type'
    LIMIT 1
  `);

  const accountTypeColumnType = String(accountTypeColumnRows?.[0]?.columnType || "");
  if (!accountTypeColumnType.includes("'employee'")) {
    await pool.query(`
      ALTER TABLE users
      MODIFY COLUMN account_type ENUM('lister', 'viewer', 'admin', 'employee') NOT NULL
    `);
  }

  const [phoneColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'phone'
  `);

  const hasPhoneColumn = Number(phoneColumnRows?.[0]?.count || 0) > 0;
  if (!hasPhoneColumn) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN phone VARCHAR(20) NULL AFTER email
    `);
  }

  const [countryCodeColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'country_code'
  `);
  if (Number(countryCodeColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN country_code CHAR(2) NOT NULL DEFAULT 'KE' AFTER phone
    `);
  }

  await pool.query(`
    UPDATE users
    SET country_code = 'KE'
    WHERE country_code IS NULL OR TRIM(country_code) = ''
  `);

  const [isBannedColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'is_banned'
  `);
  if (Number(isBannedColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0 AFTER subscription_tier
    `);
  }

  const [bannedAtColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'banned_at'
  `);
  if (Number(bannedAtColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN banned_at DATETIME NULL AFTER is_banned
    `);
  }

  const [banReasonColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'ban_reason'
  `);
  if (Number(banReasonColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN ban_reason VARCHAR(255) NULL AFTER banned_at
    `);
  }

  const [suspendedUntilColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'suspended_until'
  `);
  if (Number(suspendedUntilColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN suspended_until DATETIME NULL AFTER ban_reason
    `);
  }

  const [suspensionReasonColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'suspension_reason'
  `);
  if (Number(suspensionReasonColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN suspension_reason VARCHAR(255) NULL AFTER suspended_until
    `);
  }

  const [authProviderColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'auth_provider'
  `);
  if (Number(authProviderColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN auth_provider ENUM('local', 'google', 'apple') NOT NULL DEFAULT 'local' AFTER subscription_tier
    `);
  }

  const [providerSubjectColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'provider_subject'
  `);
  if (Number(providerSubjectColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN provider_subject VARCHAR(255) NULL AFTER auth_provider
    `);
  }

  const [emailVerifiedColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'email_verified'
  `);
  if (Number(emailVerifiedColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 1 AFTER provider_subject
    `);
  }

  const [verificationCodeHashColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'email_verification_code_hash'
  `);
  if (Number(verificationCodeHashColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN email_verification_code_hash VARCHAR(255) NULL AFTER email_verified
    `);
  }

  const [verificationExpiresAtColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'email_verification_expires_at'
  `);
  if (Number(verificationExpiresAtColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN email_verification_expires_at DATETIME NULL AFTER email_verification_code_hash
    `);
  }

  const [verificationAttemptsColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'email_verification_attempts'
  `);
  if (Number(verificationAttemptsColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN email_verification_attempts INT NOT NULL DEFAULT 0 AFTER email_verification_expires_at
    `);
  }

  const [lastVerificationSentAtColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'last_verification_sent_at'
  `);
  if (Number(lastVerificationSentAtColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN last_verification_sent_at DATETIME NULL AFTER email_verification_attempts
    `);
  }

  await pool.query(`
    UPDATE users
    SET email_verified = 1
    WHERE email_verified IS NULL
  `);

  const [emailVerifiedIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'idx_users_email_verified_created'
  `);
  if (Number(emailVerifiedIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE INDEX idx_users_email_verified_created
      ON users (email_verified, created_at)
    `);
  }

  const [providerIdentityIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'idx_users_provider_identity'
  `);
  if (Number(providerIdentityIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE INDEX idx_users_provider_identity
      ON users (auth_provider, provider_subject)
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      email VARCHAR(255) NULL,
      account_type VARCHAR(32) NULL,
      event_type VARCHAR(64) NOT NULL,
      event_reason VARCHAR(64) NULL,
      session_id VARCHAR(255) NULL,
      ip_address VARCHAR(45) NULL,
      user_agent TEXT NULL,
      device_type VARCHAR(32) NULL,
      platform VARCHAR(64) NULL,
      browser VARCHAR(64) NULL,
      os VARCHAR(64) NULL,
      accept_language VARCHAR(128) NULL,
      request_path VARCHAR(255) NULL,
      http_method VARCHAR(16) NULL,
      status_code INT NULL,
      details JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_auth_audit_user_created (user_id, created_at),
      INDEX idx_auth_audit_event_created (event_type, created_at),
      INDEX idx_auth_audit_session (session_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value JSON NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_roles (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      role_name VARCHAR(120) NOT NULL UNIQUE,
      role_description VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_role_permissions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      role_id BIGINT NOT NULL,
      module_key VARCHAR(100) NOT NULL,
      submodule_key VARCHAR(100) NOT NULL DEFAULT '*',
      can_view TINYINT(1) NOT NULL DEFAULT 0,
      can_manage TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_employee_role_permission (role_id, module_key, submodule_key),
      INDEX idx_employee_role_permissions_role (role_id),
      CONSTRAINT fk_employee_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES employee_roles(id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_module_overrides (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      module_key VARCHAR(100) NOT NULL,
      submodule_key VARCHAR(100) NOT NULL DEFAULT '*',
      can_view TINYINT(1) NOT NULL DEFAULT 0,
      can_manage TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_module_override (user_id, module_key, submodule_key),
      INDEX idx_user_module_overrides_user (user_id),
      CONSTRAINT fk_user_module_overrides_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  const [employeeRoleIdColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'employee_role_id'
  `);
  if (Number(employeeRoleIdColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN employee_role_id BIGINT NULL AFTER account_type
    `);
  }

  const [employeeRoleFkRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND CONSTRAINT_NAME = 'fk_users_employee_role'
      AND COLUMN_NAME = 'employee_role_id'
  `);
  if (Number(employeeRoleFkRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD CONSTRAINT fk_users_employee_role
        FOREIGN KEY (employee_role_id) REFERENCES employee_roles(id)
        ON DELETE SET NULL
    `);
  }

  const [emailProviderSettingRows] = await pool.execute(
    `
      SELECT setting_key
      FROM system_settings
      WHERE setting_key = 'email_delivery_provider'
      LIMIT 1
    `
  );
  if (!emailProviderSettingRows.length) {
    await pool.execute(
      `
        INSERT INTO system_settings (setting_key, setting_value)
        VALUES ('email_delivery_provider', JSON_OBJECT('provider', 'resend'))
      `
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id INT PRIMARY KEY,
      owner_id INT NULL,
      title VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      latitude DECIMAL(10, 7) NULL,
      longitude DECIMAL(10, 7) NULL,
      type ENUM('rent', 'lease') NOT NULL,
      price DECIMAL(12, 2) NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT NULL,
      image_urls JSON NULL,
      video_url TEXT NULL,
      payment_status ENUM('unpaid', 'pending', 'paid', 'expired') NOT NULL DEFAULT 'unpaid',
      premium_media_unlocked TINYINT(1) NOT NULL DEFAULT 0,
      included_image_limit INT NOT NULL DEFAULT 2,
      listing_status ENUM('draft', 'published') NOT NULL DEFAULT 'published',
      is_published TINYINT(1) NOT NULL DEFAULT 1,
      payment_intent ENUM('publish_premium', 'upgrade_premium') NULL,
      visibility_expires_at DATETIME NULL,
      sponsorship_warning_sent_at DATETIME NULL,
      sponsorship_expired_notice_sent_at DATETIME NULL,
      is_expired TINYINT(1) NOT NULL DEFAULT 0,
      expired_at DATETIME NULL,
      is_soft_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at DATETIME NULL,
      deleted_by_user_id INT NULL,
      deletion_reason VARCHAR(255) NULL,
      last_payment_reference VARCHAR(255) NULL,
      last_payment_provider ENUM('mpesa', 'stripe', 'mock') NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_properties_owner_created (owner_id, created_at),
      INDEX idx_properties_listing_visibility (listing_status, is_soft_deleted),
      INDEX idx_properties_sponsorship_expiry (payment_status, visibility_expires_at),
      CONSTRAINT fk_properties_owner
        FOREIGN KEY (owner_id) REFERENCES users(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_properties_deleted_by
        FOREIGN KEY (deleted_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);

  const [sponsorshipWarningSentAtColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'properties'
      AND COLUMN_NAME = 'sponsorship_warning_sent_at'
  `);
  if (Number(sponsorshipWarningSentAtColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE properties
      ADD COLUMN sponsorship_warning_sent_at DATETIME NULL AFTER visibility_expires_at
    `);
  }

  const [sponsorshipExpiredNoticeSentAtColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'properties'
      AND COLUMN_NAME = 'sponsorship_expired_notice_sent_at'
  `);
  if (Number(sponsorshipExpiredNoticeSentAtColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE properties
      ADD COLUMN sponsorship_expired_notice_sent_at DATETIME NULL AFTER sponsorship_warning_sent_at
    `);
  }

  const [propertiesLatitudeColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'properties'
      AND COLUMN_NAME = 'latitude'
  `);
  if (Number(propertiesLatitudeColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE properties
      ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER location
    `);
  }

  const [propertiesLongitudeColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'properties'
      AND COLUMN_NAME = 'longitude'
  `);
  if (Number(propertiesLongitudeColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE properties
      ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude
    `);
  }

  const [propertiesSponsorshipExpiryIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'properties'
      AND INDEX_NAME = 'idx_properties_sponsorship_expiry'
  `);
  if (Number(propertiesSponsorshipExpiryIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE INDEX idx_properties_sponsorship_expiry
      ON properties (payment_status, visibility_expires_at)
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS property_shortlists (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      property_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_property_shortlist (user_id, property_id),
      INDEX idx_shortlist_user_created (user_id, created_at),
      CONSTRAINT fk_shortlist_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_view_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      owner_user_id INT NOT NULL,
      viewer_user_id INT NULL,
      viewer_session_key VARCHAR(128) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_listing_view_events_property_time (property_id, viewed_at),
      INDEX idx_listing_view_events_owner_time (owner_user_id, viewed_at),
      INDEX idx_listing_view_events_viewer_time (viewer_user_id, viewed_at),
      INDEX idx_listing_view_events_session_time (viewer_session_key, viewed_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS property_alert_preferences (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 0,
      search_term VARCHAR(180) NULL,
      location_filter VARCHAR(180) NULL,
      type_filter VARCHAR(20) NOT NULL DEFAULT 'all',
      bedroom_filter VARCHAR(20) NOT NULL DEFAULT 'all',
      suitability_filter VARCHAR(20) NOT NULL DEFAULT 'all',
      popularity_filter VARCHAR(20) NOT NULL DEFAULT 'all',
      min_price DECIMAL(12, 2) NULL,
      max_price DECIMAL(12, 2) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_property_alert_preferences_user (user_id),
      INDEX idx_property_alert_preferences_enabled (is_enabled),
      CONSTRAINT fk_property_alert_preferences_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_payments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      user_id INT NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      amount_kes DECIMAL(12, 2) NULL,
      currency VARCHAR(10) NOT NULL,
      provider ENUM('mpesa', 'stripe', 'mock') NOT NULL,
      status ENUM('pending', 'paid', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
      payment_method_label VARCHAR(64) NULL,
      provider_ref VARCHAR(255) NULL,
      checkout_ref VARCHAR(128) NOT NULL,
      receipt_number VARCHAR(128) NULL,
      receipt_issued_at DATETIME NULL,
      paid_at DATETIME NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_listing_payments_checkout_ref (checkout_ref),
      INDEX idx_listing_payments_property_status (property_id, status),
      INDEX idx_listing_payments_user_created (user_id, created_at),
      INDEX idx_listing_payments_provider_ref (provider_ref),
      CONSTRAINT fk_listing_payments_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  const [amountKesColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND COLUMN_NAME = 'amount_kes'
  `);
  if (Number(amountKesColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_payments
      ADD COLUMN amount_kes DECIMAL(12, 2) NULL AFTER amount
    `);
  }

  const [paymentMethodLabelColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND COLUMN_NAME = 'payment_method_label'
  `);
  if (Number(paymentMethodLabelColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_payments
      ADD COLUMN payment_method_label VARCHAR(64) NULL AFTER status
    `);
  }

  const [receiptNumberColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND COLUMN_NAME = 'receipt_number'
  `);
  if (Number(receiptNumberColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_payments
      ADD COLUMN receipt_number VARCHAR(128) NULL AFTER checkout_ref
    `);
  }

  const [receiptIssuedAtColumnRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND COLUMN_NAME = 'receipt_issued_at'
  `);
  if (Number(receiptIssuedAtColumnRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_payments
      ADD COLUMN receipt_issued_at DATETIME NULL AFTER receipt_number
    `);
  }

  const [statusPaidAtIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND INDEX_NAME = 'idx_listing_payments_status_paid_at'
  `);
  if (Number(statusPaidAtIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE INDEX idx_listing_payments_status_paid_at
      ON listing_payments (status, paid_at)
    `);
  }

  const [userStatusPaidAtIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND INDEX_NAME = 'idx_listing_payments_user_status_paid_at'
  `);
  if (Number(userStatusPaidAtIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE INDEX idx_listing_payments_user_status_paid_at
      ON listing_payments (user_id, status, paid_at)
    `);
  }

  const [providerPaidAtIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND INDEX_NAME = 'idx_listing_payments_provider_paid_at'
  `);
  if (Number(providerPaidAtIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE INDEX idx_listing_payments_provider_paid_at
      ON listing_payments (provider, paid_at)
    `);
  }

  const [receiptNumberIndexRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND INDEX_NAME = 'uniq_listing_payments_receipt_number'
  `);
  if (Number(receiptNumberIndexRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      CREATE UNIQUE INDEX uniq_listing_payments_receipt_number
      ON listing_payments (receipt_number)
    `);
  }

  await pool.query(`
    INSERT INTO properties (
      id,
      owner_id,
      title,
      location,
      latitude,
      longitude,
      type,
      price,
      description,
      image_url,
      image_urls,
      payment_status,
      premium_media_unlocked,
      included_image_limit,
      listing_status,
      is_published,
      payment_intent
    )
    SELECT
      lp.property_id,
      NULL,
      CONCAT('Legacy Property #', lp.property_id),
      'Unknown',
      NULL,
      NULL,
      'rent',
      0,
      'Backfilled placeholder listing created to preserve payment foreign-key integrity.',
      NULL,
      JSON_ARRAY(),
      'paid',
      1,
      2,
      'published',
      1,
      'upgrade_premium'
    FROM listing_payments lp
    LEFT JOIN properties p ON p.id = lp.property_id
    WHERE p.id IS NULL
      AND lp.property_id IS NOT NULL
  `);

  const [paymentPropertyFkRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_payments'
      AND CONSTRAINT_NAME = 'fk_listing_payments_property'
      AND COLUMN_NAME = 'property_id'
  `);
  if (Number(paymentPropertyFkRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_payments
      ADD CONSTRAINT fk_listing_payments_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE CASCADE
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_pricing_rules (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      listing_type ENUM('rent', 'lease') NOT NULL,
      min_property_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
      max_property_value DECIMAL(12, 2) NULL,
      monthly_fee_usd DECIMAL(10, 2) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_listing_pricing_type_range (listing_type, min_property_value, max_property_value)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_duration_discounts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      min_months INT NOT NULL,
      max_months INT NULL,
      discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_listing_discount_range (min_months, max_months)
    )
  `);

  const [pricingRuleCountRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM listing_pricing_rules
  `);
  if (Number(pricingRuleCountRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      INSERT INTO listing_pricing_rules (
        listing_type,
        min_property_value,
        max_property_value,
        monthly_fee_usd,
        is_active
      ) VALUES
        ('rent', 0, 50000, 5.00, 1),
        ('rent', 50000.01, 150000, 10.00, 1),
        ('rent', 150000.01, NULL, 18.00, 1),
        ('lease', 0, 100000, 8.00, 1),
        ('lease', 100000.01, 300000, 16.00, 1),
        ('lease', 300000.01, NULL, 28.00, 1)
    `);
  }

  const [discountCountRows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM listing_duration_discounts
  `);
  if (Number(discountCountRows?.[0]?.count || 0) === 0) {
    await pool.query(`
      INSERT INTO listing_duration_discounts (
        min_months,
        max_months,
        discount_percent,
        is_active
      ) VALUES
        (1, 2, 0, 1),
        (3, 5, 10, 1),
        (6, 11, 18, 1),
        (12, NULL, 28, 1)
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_reports (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      lister_user_id INT NOT NULL,
      reporter_user_id INT NULL,
      reporter_email VARCHAR(255) NULL,
      reason_code VARCHAR(64) NOT NULL,
      custom_detail TEXT NULL,
      status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
      outcome ENUM(
        'dismissed',
        'listing_suspended',
        'lister_suspended',
        'lister_banned',
        'both_suspended',
        'both_banned'
      ) NULL,
      resolved_at DATETIME NULL,
      resolved_by_admin_id INT NULL,
      admin_notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_listing_reports_property (property_id),
      INDEX idx_listing_reports_lister (lister_user_id),
      INDEX idx_listing_reports_status_created (status, created_at),
      INDEX idx_listing_reports_reporter_email (reporter_email, property_id),
      INDEX idx_listing_reports_reporter_user (reporter_user_id, property_id),
      CONSTRAINT fk_listing_reports_reporter
        FOREIGN KEY (reporter_user_id) REFERENCES users(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_listing_reports_resolver
        FOREIGN KEY (resolved_by_admin_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);

  // Migrations for existing installs: allow anonymous reporters.
  const [reporterUserCol] = await pool.query(`
    SELECT IS_NULLABLE AS isNullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_reports'
      AND COLUMN_NAME = 'reporter_user_id'
    LIMIT 1
  `);
  if (reporterUserCol?.[0]?.isNullable === "NO") {
    try {
      await pool.query(`ALTER TABLE listing_reports DROP FOREIGN KEY fk_listing_reports_reporter`);
    } catch (_error) { /* ignore */ }
    try {
      await pool.query(`ALTER TABLE listing_reports DROP INDEX uniq_listing_reports_reporter_property`);
    } catch (_error) { /* ignore */ }
    await pool.query(`ALTER TABLE listing_reports MODIFY COLUMN reporter_user_id INT NULL`);
    await pool.query(`
      ALTER TABLE listing_reports
      ADD CONSTRAINT fk_listing_reports_reporter
        FOREIGN KEY (reporter_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    `);
    try {
      await pool.query(`ALTER TABLE listing_reports ADD INDEX idx_listing_reports_reporter_user (reporter_user_id, property_id)`);
    } catch (_error) { /* ignore */ }
  }

  const [reporterEmailCol] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_reports'
      AND COLUMN_NAME = 'reporter_email'
  `);
  if (Number(reporterEmailCol?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_reports
      ADD COLUMN reporter_email VARCHAR(255) NULL AFTER reporter_user_id
    `);
    try {
      await pool.query(`
        ALTER TABLE listing_reports
        ADD INDEX idx_listing_reports_reporter_email (reporter_email, property_id)
      `);
    } catch (_error) { /* ignore */ }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_conversations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      viewer_user_id INT NOT NULL,
      lister_user_id INT NOT NULL,
      last_message_sender_id INT NULL,
      last_message_preview VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_listing_conversation_pair (property_id, viewer_user_id, lister_user_id),
      INDEX idx_listing_conversations_viewer_last (viewer_user_id, last_message_at),
      INDEX idx_listing_conversations_lister_last (lister_user_id, last_message_at),
      INDEX idx_listing_conversations_listing_last (property_id, last_message_at),
      CONSTRAINT fk_listing_conversations_viewer
        FOREIGN KEY (viewer_user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_listing_conversations_lister
        FOREIGN KEY (lister_user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_listing_conversations_last_sender
        FOREIGN KEY (last_message_sender_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      conversation_id BIGINT NOT NULL,
      sender_user_id INT NOT NULL,
      message_text TEXT NOT NULL,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_listing_messages_conversation_created (conversation_id, created_at),
      INDEX idx_listing_messages_sender_created (sender_user_id, created_at),
      CONSTRAINT fk_listing_messages_conversation
        FOREIGN KEY (conversation_id) REFERENCES listing_conversations(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_listing_messages_sender
        FOREIGN KEY (sender_user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  const [conversationLastSenderCol] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_conversations'
      AND COLUMN_NAME = 'last_message_sender_id'
  `);
  if (Number(conversationLastSenderCol?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_conversations
      ADD COLUMN last_message_sender_id INT NULL AFTER lister_user_id
    `);
    await pool.query(`
      ALTER TABLE listing_conversations
      ADD CONSTRAINT fk_listing_conversations_last_sender
        FOREIGN KEY (last_message_sender_id) REFERENCES users(id)
        ON DELETE SET NULL
    `);
  }

  const [conversationLastPreviewCol] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_conversations'
      AND COLUMN_NAME = 'last_message_preview'
  `);
  if (Number(conversationLastPreviewCol?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_conversations
      ADD COLUMN last_message_preview VARCHAR(255) NULL AFTER last_message_sender_id
    `);
  }

  const [messageReadAtCol] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'listing_messages'
      AND COLUMN_NAME = 'read_at'
  `);
  if (Number(messageReadAtCol?.[0]?.count || 0) === 0) {
    await pool.query(`
      ALTER TABLE listing_messages
      ADD COLUMN read_at DATETIME NULL AFTER message_text
    `);
  }

  if (SEED_ADMIN_ENABLED) {
    if (!SEEDED_ADMIN.email || !SEEDED_ADMIN.password || !SEEDED_ADMIN.fullName) {
      console.warn(
        "Skipping admin seed: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, and SEED_ADMIN_FULL_NAME are required when seeding is enabled."
      );
    } else {
      const [existingSeedAdminRows] = await pool.execute(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [SEEDED_ADMIN.email]
      );

      if (!existingSeedAdminRows.length) {
        const hashedPassword = await bcrypt.hash(SEEDED_ADMIN.password, BCRYPT_ROUNDS);
        await pool.execute(
          `
            INSERT INTO users (
              full_name,
              email,
              phone,
              password,
              account_type,
              subscription_tier,
              auth_provider,
              email_verified
            )
            VALUES (?, ?, ?, ?, ?, ?, 'local', 1)
          `,
          [
            SEEDED_ADMIN.fullName,
            SEEDED_ADMIN.email,
            SEEDED_ADMIN.phone || null,
            hashedPassword,
            SEEDED_ADMIN.accountType,
            SEEDED_ADMIN.subscriptionTier
          ]
        );
        console.log(`Seeded admin user account (${SEEDED_ADMIN.email})`);
      }
    }
  }

  if (SEED_DEMO_LISTER_ENABLED) {
    if (!SEEDED_DEMO_LISTER.email || !SEEDED_DEMO_LISTER.password || !SEEDED_DEMO_LISTER.fullName) {
      console.warn(
        "Skipping demo lister seed: SEED_DEMO_LISTER_EMAIL, SEED_DEMO_LISTER_PASSWORD, and SEED_DEMO_LISTER_FULL_NAME are required when demo lister seeding is enabled."
      );
    } else {
      const [existingDemoListerRows] = await pool.execute(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [SEEDED_DEMO_LISTER.email]
      );

      if (!existingDemoListerRows.length) {
        const hashedPassword = await bcrypt.hash(SEEDED_DEMO_LISTER.password, BCRYPT_ROUNDS);
        await pool.execute(
          `
            INSERT INTO users (
              full_name,
              email,
              phone,
              password,
              account_type,
              subscription_tier,
              auth_provider,
              email_verified
            )
            VALUES (?, ?, ?, ?, ?, ?, 'local', 1)
          `,
          [
            SEEDED_DEMO_LISTER.fullName,
            SEEDED_DEMO_LISTER.email,
            SEEDED_DEMO_LISTER.phone || null,
            hashedPassword,
            SEEDED_DEMO_LISTER.accountType,
            SEEDED_DEMO_LISTER.subscriptionTier
          ]
        );
        console.log(`Seeded demo lister account (${SEEDED_DEMO_LISTER.email}) — owns default catalog listings`);
      }
    }
  }
}

/**
 * Assigns ownerId to in-memory seed listings so "Report listing" works for the demo catalog.
 * Uses the demo lister row looked up by SEED_DEMO_LISTER_EMAIL (default: demo-lister@kenreal.local).
 */
async function syncDemoListingOwners(properties) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return;
  }
  const email = readStringEnv(process.env.SEED_DEMO_LISTER_EMAIL, "demo-lister@kenreal.local").toLowerCase();
  try {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE email = ? AND account_type = 'lister' LIMIT 1",
      [email]
    );
    const listerId = Number(rows?.[0]?.id);
    if (!Number.isFinite(listerId) || listerId <= 0) {
      return;
    }
    let updated = 0;
    properties.forEach((p) => {
      if (p && (p.ownerId === undefined || p.ownerId === null)) {
        p.ownerId = listerId;
        updated += 1;
      }
    });
    if (updated > 0) {
      console.log(`Linked ${updated} demo listing(s) to lister id ${listerId} (${email})`);
    }
  } catch (error) {
    console.warn("syncDemoListingOwners:", error.message);
  }
}

function toDbDateTimeOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  const seconds = String(parsed.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function syncPropertiesTable(properties) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return;
  }

  const placeholders = properties.filter((item) => Number.isFinite(Number(item?.id)) && Number(item.id) > 0);
  for (const item of placeholders) {
    const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []);
    await pool.execute(
      `
        INSERT INTO properties (
          id,
          owner_id,
          title,
          location,
          latitude,
          longitude,
          type,
          price,
          description,
          image_url,
          image_urls,
          video_url,
          payment_status,
          premium_media_unlocked,
          included_image_limit,
          listing_status,
          is_published,
          payment_intent,
          visibility_expires_at,
          is_expired,
          expired_at,
          is_soft_deleted,
          deleted_at,
          deleted_by_user_id,
          deletion_reason,
          last_payment_reference,
          last_payment_provider
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          owner_id = VALUES(owner_id),
          title = VALUES(title),
          location = VALUES(location),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          type = VALUES(type),
          price = VALUES(price),
          description = VALUES(description),
          image_url = VALUES(image_url),
          image_urls = VALUES(image_urls),
          video_url = VALUES(video_url),
          payment_status = VALUES(payment_status),
          premium_media_unlocked = VALUES(premium_media_unlocked),
          included_image_limit = VALUES(included_image_limit),
          listing_status = VALUES(listing_status),
          is_published = VALUES(is_published),
          payment_intent = VALUES(payment_intent),
          visibility_expires_at = VALUES(visibility_expires_at),
          is_expired = VALUES(is_expired),
          expired_at = VALUES(expired_at),
          is_soft_deleted = VALUES(is_soft_deleted),
          deleted_at = VALUES(deleted_at),
          deleted_by_user_id = VALUES(deleted_by_user_id),
          deletion_reason = VALUES(deletion_reason),
          last_payment_reference = VALUES(last_payment_reference),
          last_payment_provider = VALUES(last_payment_provider)
      `,
      [
        Number(item.id),
        Number.isFinite(Number(item.ownerId)) ? Number(item.ownerId) : null,
        String(item.title || `Property ${item.id}`),
        String(item.location || "Unknown"),
        Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
        Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null,
        ["rent", "lease"].includes(String(item.type || "").toLowerCase()) ? String(item.type).toLowerCase() : "rent",
        Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
        String(item.description || ""),
        String(item.imageUrl || imageUrls[0] || ""),
        JSON.stringify(imageUrls),
        item.videoUrl ? String(item.videoUrl) : null,
        ["unpaid", "pending", "paid", "expired"].includes(String(item.paymentStatus || "").toLowerCase())
          ? String(item.paymentStatus).toLowerCase()
          : "unpaid",
        item.premiumMediaUnlocked ? 1 : 0,
        Number.isFinite(Number(item.includedImageLimit)) ? Number(item.includedImageLimit) : 2,
        ["draft", "published"].includes(String(item.listingStatus || "").toLowerCase())
          ? String(item.listingStatus).toLowerCase()
          : "published",
        item.isPublished === false ? 0 : 1,
        ["publish_premium", "upgrade_premium"].includes(String(item.paymentIntent || "").toLowerCase())
          ? String(item.paymentIntent).toLowerCase()
          : null,
        toDbDateTimeOrNull(item.visibilityExpiresAt),
        item.isExpired ? 1 : 0,
        toDbDateTimeOrNull(item.expiredAt),
        item.isSoftDeleted ? 1 : 0,
        toDbDateTimeOrNull(item.deletedAt),
        Number.isFinite(Number(item.deletedByUserId)) ? Number(item.deletedByUserId) : null,
        item.deletionReason ? String(item.deletionReason) : null,
        item.lastPaymentReference ? String(item.lastPaymentReference) : null,
        ["mpesa", "stripe", "mock"].includes(String(item.lastPaymentProvider || "").toLowerCase())
          ? String(item.lastPaymentProvider).toLowerCase()
          : null
      ]
    );
  }
}

module.exports = {
  pool,
  waitForDatabase,
  initializeDatabase,
  syncDemoListingOwners,
  syncPropertiesTable
};
