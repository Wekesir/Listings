const properties = require("../data/properties");
const { pool } = require("../config/db");
const { PAYMENT_CONFIG } = require("../config/payments");
const fs = require("fs");
const crypto = require("crypto");
const { createListingInquiryConversation } = require("./messageController");
const { getUsdToKesRate } = require("../services/fxService");
const {
  resolveProvider,
  inferRecommendedProvider,
  buildCheckoutRef,
  createStripeCheckout,
  createMpesaCheckout
} = require("../services/paymentService");
const { sendNewMatchingListingAlertEmail } = require("../services/auth/emailService");
const { emitListingMetricsUpdated } = require("../realtime/socket");
const { ACCESS_ACTIONS, MODULE_KEYS, hasModulePermission } = require("../utils/accessControl");

const BASIC_INCLUDED_IMAGE_LIMIT = Math.max(1, PAYMENT_CONFIG.basicIncludedImageLimit || 2);
const PAID_MAX_IMAGE_LIMIT = Math.max(BASIC_INCLUDED_IMAGE_LIMIT, PAYMENT_CONFIG.paidMaxImageLimit || 12);
const LISTING_STATUS = {
  DRAFT: "draft",
  PUBLISHED: "published"
};
const PAYMENT_STATUS = {
  UNPAID: "unpaid",
  PENDING: "pending",
  PAID: "paid",
  EXPIRED: "expired"
};
const LISTING_PAYMENT_INTENT = {
  PUBLISH_PREMIUM: "publish_premium",
  UPGRADE_PREMIUM: "upgrade_premium"
};
const VIEW_DEDUP_WINDOW_MINUTES = 30;

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

function parseCoordinateOrNull(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  const text = String(rawValue).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return numeric;
}

async function syncPropertyToDatabase(property) {
  if (!property || !Number.isFinite(Number(property.id)) || Number(property.id) <= 0) {
    return;
  }
  const imageUrls = Array.isArray(property.imageUrls)
    ? property.imageUrls
    : (property.imageUrl ? [property.imageUrl] : []);
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
      Number(property.id),
      Number.isFinite(Number(property.ownerId)) ? Number(property.ownerId) : null,
      String(property.title || `Property ${property.id}`),
      String(property.location || "Unknown"),
      Number.isFinite(Number(property.latitude)) ? Number(property.latitude) : null,
      Number.isFinite(Number(property.longitude)) ? Number(property.longitude) : null,
      ["rent", "lease"].includes(String(property.type || "").toLowerCase())
        ? String(property.type).toLowerCase()
        : "rent",
      Number.isFinite(Number(property.price)) ? Number(property.price) : 0,
      String(property.description || ""),
      String(property.imageUrl || imageUrls[0] || ""),
      JSON.stringify(imageUrls),
      property.videoUrl ? String(property.videoUrl) : null,
      ["unpaid", "pending", "paid", "expired"].includes(String(property.paymentStatus || "").toLowerCase())
        ? String(property.paymentStatus).toLowerCase()
        : "unpaid",
      property.premiumMediaUnlocked ? 1 : 0,
      Number.isFinite(Number(property.includedImageLimit)) ? Number(property.includedImageLimit) : BASIC_INCLUDED_IMAGE_LIMIT,
      ["draft", "published"].includes(String(property.listingStatus || "").toLowerCase())
        ? String(property.listingStatus).toLowerCase()
        : "published",
      property.isPublished === false ? 0 : 1,
      ["publish_premium", "upgrade_premium"].includes(String(property.paymentIntent || "").toLowerCase())
        ? String(property.paymentIntent).toLowerCase()
        : null,
      toDbDateTimeOrNull(property.visibilityExpiresAt),
      property.isExpired ? 1 : 0,
      toDbDateTimeOrNull(property.expiredAt),
      property.isSoftDeleted ? 1 : 0,
      toDbDateTimeOrNull(property.deletedAt),
      Number.isFinite(Number(property.deletedByUserId)) ? Number(property.deletedByUserId) : null,
      property.deletionReason ? String(property.deletionReason) : null,
      property.lastPaymentReference ? String(property.lastPaymentReference) : null,
      ["mpesa", "stripe", "mock"].includes(String(property.lastPaymentProvider || "").toLowerCase())
        ? String(property.lastPaymentProvider).toLowerCase()
        : null
    ]
  );
}

function normalizePaymentIntent(rawIntent) {
  const normalized = String(rawIntent || "").trim().toLowerCase();
  if (normalized === LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM) {
    return LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM;
  }
  return LISTING_PAYMENT_INTENT.UPGRADE_PREMIUM;
}

function getListingStatus(property) {
  if (property?.isPublished === false) return LISTING_STATUS.DRAFT;
  const normalized = String(property?.listingStatus || "").trim().toLowerCase();
  return normalized === LISTING_STATUS.DRAFT ? LISTING_STATUS.DRAFT : LISTING_STATUS.PUBLISHED;
}

function isPublishedListing(property) {
  return getListingStatus(property) === LISTING_STATUS.PUBLISHED;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function addMonthsToDate(baseDate, monthsToAdd) {
  const value = new Date(baseDate.getTime());
  value.setMonth(value.getMonth() + Number(monthsToAdd || 0));
  return value;
}

function applyListingExpiryState(property) {
  if (!property || typeof property !== "object") return property;
  const expiresAt = parseDateOrNull(property.visibilityExpiresAt);
  if (!expiresAt) return property;
  if (expiresAt.getTime() > Date.now()) return property;

  if (isPublishedListing(property) || !property.isExpired) {
    property.listingStatus = LISTING_STATUS.DRAFT;
    property.isPublished = false;
    property.isExpired = true;
    property.expiredAt = property.expiredAt || new Date().toISOString();
    property.paymentStatus = PAYMENT_STATUS.EXPIRED;
    property.premiumMediaUnlocked = false;
  }
  return property;
}

function applyPaymentCycleToListing(property, months) {
  const normalizedMonths = parseMonths(months, 1);
  const now = new Date();
  const currentExpiry = parseDateOrNull(property.visibilityExpiresAt);
  const baseDate = currentExpiry && currentExpiry.getTime() > now.getTime()
    ? currentExpiry
    : now;
  const nextExpiry = addMonthsToDate(baseDate, normalizedMonths);

  property.paymentStatus = PAYMENT_STATUS.PAID;
  property.premiumMediaUnlocked = true;
  property.listingStatus = LISTING_STATUS.PUBLISHED;
  property.isPublished = true;
  property.isExpired = false;
  property.expiredAt = null;
  property.visibilityExpiresAt = nextExpiry.toISOString();
  return property;
}

function enforceListingExpiryAcrossAll() {
  properties.forEach((item) => {
    ensurePropertyPaymentState(item);
    applyListingExpiryState(item);
  });
}

function ensurePropertyPaymentState(property) {
  if (!property || typeof property !== "object") return property;
  if (!Object.prototype.hasOwnProperty.call(property, "paymentStatus")) {
    property.paymentStatus = PAYMENT_STATUS.UNPAID;
  }
  if (!Object.prototype.hasOwnProperty.call(property, "premiumMediaUnlocked")) {
    property.premiumMediaUnlocked = false;
  }
  if (!Object.prototype.hasOwnProperty.call(property, "includedImageLimit")) {
    property.includedImageLimit = BASIC_INCLUDED_IMAGE_LIMIT;
  }
  if (!Object.prototype.hasOwnProperty.call(property, "visibilityExpiresAt")) {
    property.visibilityExpiresAt = null;
  }
  if (!Object.prototype.hasOwnProperty.call(property, "isExpired")) {
    property.isExpired = false;
  }
  if (!Object.prototype.hasOwnProperty.call(property, "expiredAt")) {
    property.expiredAt = null;
  }
  const status = getListingStatus(property);
  property.listingStatus = status;
  property.isPublished = status === LISTING_STATUS.PUBLISHED;
  return property;
}

properties.forEach((item) => {
  ensurePropertyPaymentState(item);
});

function isTruthyFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function isSoftDeleted(property) {
  return Boolean(property?.isSoftDeleted);
}

function isVisibleToPublic(property) {
  return !isSoftDeleted(property) && isPublishedListing(property);
}

function normalizeAlertToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAlertText(value, maxLength = 180) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function normalizeAlertEnum(value, allowed, fallback = "all") {
  const normalized = normalizeAlertToken(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeAlertPrice(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100) / 100;
}

function normalizeAlertFilters(rawFilters = {}) {
  return {
    searchTerm: normalizeAlertText(rawFilters.searchTerm, 180),
    locationFilter: normalizeAlertText(rawFilters.locationFilter, 180),
    typeFilter: normalizeAlertEnum(rawFilters.typeFilter, ["all", "rent", "lease"], "all"),
    bedroomFilter: normalizeAlertEnum(rawFilters.bedroomFilter, ["all", "studio", "1", "2", "3", "4plus"], "all"),
    suitabilityFilter: normalizeAlertEnum(rawFilters.suitabilityFilter, ["all", "family", "single", "business", "luxury", "budget"], "all"),
    popularityFilter: normalizeAlertEnum(rawFilters.popularityFilter, ["all", "popular"], "all"),
    minPrice: normalizeAlertPrice(rawFilters.minPrice),
    maxPrice: normalizeAlertPrice(rawFilters.maxPrice)
  };
}

function getListingBedroomCount(item) {
  const title = String(item?.title || "").toLowerCase();
  if (title.includes("studio") || title.includes("bedsitter")) return 0;
  const match = title.match(/(\d+)\s*bed/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getListingPopularityScore(item) {
  const explicit = Number(item?.popularityScore);
  if (Number.isFinite(explicit)) return explicit;
  const price = Number(item?.price);
  const normalizedPrice = Number.isFinite(price) ? price : 0;
  const typeBoost = String(item?.type || "").toLowerCase() === "rent" ? 6 : 3;
  const idFactor = Number(item?.id) % 9;
  return Math.round((normalizedPrice / 10000) % 40) + typeBoost + idFactor;
}

function getListingSuitabilityTags(item) {
  const title = String(item?.title || "").toLowerCase();
  const description = String(item?.description || "").toLowerCase();
  const location = String(item?.location || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  const price = Number(item?.price) || 0;
  const text = `${title} ${description} ${location}`;
  const tags = new Set();

  if (type === "lease" || /(office|retail|warehouse|commercial)/.test(text)) {
    tags.add("business");
  } else {
    tags.add("residential");
  }
  if (/(family|townhouse|villa|spacious|gated|garden)/.test(text) || (getListingBedroomCount(item) ?? 0) >= 3) {
    tags.add("family");
  }
  if (/(studio|bedsitter|compact|student|young professional)/.test(text) || (getListingBedroomCount(item) ?? -1) <= 1) {
    tags.add("single");
  }
  if (/(luxury|premium|modern|prime)/.test(text) || price >= 200000) {
    tags.add("luxury");
  }
  if (/(affordable|budget|value)/.test(text) || (price > 0 && price <= 35000)) {
    tags.add("budget");
  }
  return tags;
}

function doesAlertLocationMatch(itemLocation, selectedLocation) {
  const locationText = normalizeAlertToken(itemLocation);
  const selected = normalizeAlertToken(selectedLocation);
  if (!selected || selected === "all") return true;
  if (!locationText) return false;
  if (locationText === selected || locationText.includes(selected)) return true;
  const tokens = locationText
    .split(/[,/|-]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return tokens.includes(selected);
}

function matchesAlertBaseFilters(property, filters) {
  if (!property || !isVisibleToPublic(property)) return false;
  const q = normalizeAlertToken(filters.searchTerm);
  const title = normalizeAlertToken(property.title);
  const location = normalizeAlertToken(property.location);

  if (q && !(title.includes(q) || location.includes(q))) return false;
  if (!doesAlertLocationMatch(property.location, filters.locationFilter)) return false;
  if (filters.typeFilter !== "all" && normalizeAlertToken(property.type) !== filters.typeFilter) return false;

  if (filters.bedroomFilter !== "all") {
    const count = getListingBedroomCount(property);
    if (filters.bedroomFilter === "studio" && count !== 0) return false;
    if (filters.bedroomFilter === "4plus" && !(count !== null && count >= 4)) return false;
    if (!["studio", "4plus"].includes(filters.bedroomFilter) && count !== Number(filters.bedroomFilter)) return false;
  }

  if (filters.suitabilityFilter !== "all" && !getListingSuitabilityTags(property).has(filters.suitabilityFilter)) {
    return false;
  }

  const numericPrice = Number(property.price);
  const price = Number.isFinite(numericPrice) ? numericPrice : null;
  if (filters.minPrice !== null && !(price !== null && price >= filters.minPrice)) return false;
  if (filters.maxPrice !== null && !(price !== null && price <= filters.maxPrice)) return false;

  return true;
}

function matchesAlertFilters(property, filters, listingPool) {
  if (!matchesAlertBaseFilters(property, filters)) return false;
  if (filters.popularityFilter !== "popular") return true;

  const candidates = (Array.isArray(listingPool) ? listingPool : [])
    .filter((item) => matchesAlertBaseFilters(item, filters));
  if (candidates.length === 0) return false;

  const scores = candidates.map((item) => getListingPopularityScore(item)).sort((a, b) => b - a);
  const thresholdIndex = Math.max(0, Math.ceil(scores.length * 0.4) - 1);
  const threshold = scores[thresholdIndex] ?? 0;
  return getListingPopularityScore(property) >= threshold;
}

function buildAlertFilterSummary(filters) {
  const parts = [];
  if (filters.searchTerm) parts.push(`search "${filters.searchTerm}"`);
  if (filters.locationFilter && normalizeAlertToken(filters.locationFilter) !== "all") parts.push(`location ${filters.locationFilter}`);
  if (filters.typeFilter !== "all") parts.push(`type ${filters.typeFilter}`);
  if (filters.bedroomFilter !== "all") parts.push(`bedrooms ${filters.bedroomFilter}`);
  if (filters.suitabilityFilter !== "all") parts.push(`best for ${filters.suitabilityFilter}`);
  if (filters.popularityFilter === "popular") parts.push("most popular");
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    parts.push(`price ${filters.minPrice ?? 0} - ${filters.maxPrice ?? "any"}`);
  }
  return parts.join(", ");
}

function buildRestrictionContext(item) {
  return {
    isSoftDeleted: Boolean(item?.isSoftDeleted),
    deletedAt: item?.deletedAt || null,
    deletionReason: item?.deletionReason || null
  };
}

function getSessionUserId(req) {
  const userId = Number(req.session?.user?.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

function buildViewerSessionKey(req) {
  const sessionId = String(req.sessionID || "").trim();
  const forwardedFor = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const ipAddress = forwardedFor || String(req.ip || "").trim();
  const userAgent = String(req.headers?.["user-agent"] || "").trim();
  const seed = `${sessionId}|${ipAddress}|${userAgent}`;
  if (!seed.replace(/\|/g, "").trim()) return null;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function emitListerMetricsUpdate(ownerUserId, propertyId, source) {
  const listerUserId = Number(ownerUserId);
  const normalizedPropertyId = Number(propertyId);
  if (!Number.isFinite(listerUserId) || listerUserId <= 0) return;
  if (!Number.isFinite(normalizedPropertyId) || normalizedPropertyId <= 0) return;
  emitListingMetricsUpdated(listerUserId, {
    listerUserId,
    propertyId: normalizedPropertyId,
    source: String(source || "unknown"),
    occurredAt: new Date().toISOString()
  });
}

async function trackPropertyViewEvent(req, property) {
  const propertyId = Number(property?.id);
  const ownerUserId = Number(property?.ownerId);
  if (!Number.isFinite(propertyId) || propertyId <= 0) return false;
  if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) return false;

  const sessionUser = req.session?.user || null;
  const viewerUserId = getSessionUserId(req);
  if (viewerUserId && viewerUserId === ownerUserId) return false;
  if (String(sessionUser?.accountType || "").toLowerCase() === "admin") return false;

  const sessionKey = buildViewerSessionKey(req);
  if (!viewerUserId && !sessionKey) return false;

  const forwardedFor = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const ipAddress = (forwardedFor || String(req.ip || "").trim()).slice(0, 64) || null;
  const userAgent = String(req.headers?.["user-agent"] || "").trim().slice(0, 255) || null;

  try {
    if (viewerUserId) {
      const [insertResult] = await pool.execute(
        `
          INSERT INTO listing_view_events (
            property_id,
            owner_user_id,
            viewer_user_id,
            viewer_session_key,
            ip_address,
            user_agent,
            viewed_at
          )
          SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
          FROM DUAL
          WHERE NOT EXISTS (
            SELECT 1
            FROM listing_view_events
            WHERE property_id = ?
              AND viewer_user_id = ?
              AND viewed_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${VIEW_DEDUP_WINDOW_MINUTES} MINUTE)
          )
        `,
        [
          propertyId,
          ownerUserId,
          viewerUserId,
          sessionKey,
          ipAddress,
          userAgent,
          propertyId,
          viewerUserId
        ]
      );
      return Number(insertResult?.affectedRows || 0) > 0;
    }

    const [insertResult] = await pool.execute(
      `
        INSERT INTO listing_view_events (
          property_id,
          owner_user_id,
          viewer_user_id,
          viewer_session_key,
          ip_address,
          user_agent,
          viewed_at
        )
        SELECT ?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1
          FROM listing_view_events
          WHERE property_id = ?
            AND viewer_session_key = ?
            AND viewed_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${VIEW_DEDUP_WINDOW_MINUTES} MINUTE)
        )
      `,
      [
        propertyId,
        ownerUserId,
        sessionKey,
        ipAddress,
        userAgent,
        propertyId,
        sessionKey
      ]
    );
    return Number(insertResult?.affectedRows || 0) > 0;
  } catch (_error) {
    return false;
  }
}

function mapAlertPreferenceRow(row) {
  if (!row) {
    return {
      enabled: false,
      filters: normalizeAlertFilters({})
    };
  }
  return {
    enabled: Boolean(row.isEnabled),
    filters: normalizeAlertFilters({
      searchTerm: row.searchTerm,
      locationFilter: row.locationFilter,
      typeFilter: row.typeFilter,
      bedroomFilter: row.bedroomFilter,
      suitabilityFilter: row.suitabilityFilter,
      popularityFilter: row.popularityFilter,
      minPrice: row.minPrice,
      maxPrice: row.maxPrice
    })
  };
}

async function loadUserAlertPreference(userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        is_enabled AS isEnabled,
        search_term AS searchTerm,
        location_filter AS locationFilter,
        type_filter AS typeFilter,
        bedroom_filter AS bedroomFilter,
        suitability_filter AS suitabilityFilter,
        popularity_filter AS popularityFilter,
        min_price AS minPrice,
        max_price AS maxPrice
      FROM property_alert_preferences
      WHERE user_id = ?
      LIMIT 1
    `,
    [Number(userId)]
  );
  return mapAlertPreferenceRow(rows[0] || null);
}

async function dispatchNewPropertyAlerts(newProperty) {
  if (!isVisibleToPublic(newProperty)) return;

  const [rows] = await pool.execute(
    `
      SELECT
        pap.user_id AS userId,
        pap.search_term AS searchTerm,
        pap.location_filter AS locationFilter,
        pap.type_filter AS typeFilter,
        pap.bedroom_filter AS bedroomFilter,
        pap.suitability_filter AS suitabilityFilter,
        pap.popularity_filter AS popularityFilter,
        pap.min_price AS minPrice,
        pap.max_price AS maxPrice,
        u.full_name AS fullName,
        u.email AS email
      FROM property_alert_preferences pap
      INNER JOIN users u ON u.id = pap.user_id
      WHERE pap.is_enabled = 1
        AND u.email IS NOT NULL
        AND u.email_verified = 1
        AND u.id <> ?
    `,
    [Number(newProperty.ownerId || 0)]
  );

  if (!rows.length) return;

  const appFrontendUrl = String(process.env.APP_FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  const listingUrl = `${appFrontendUrl}/listings/${newProperty.id}`;
  const publicListings = properties.filter((item) => isVisibleToPublic(item));
  const sendJobs = rows
    .map((row) => {
      const filters = normalizeAlertFilters({
        searchTerm: row.searchTerm,
        locationFilter: row.locationFilter,
        typeFilter: row.typeFilter,
        bedroomFilter: row.bedroomFilter,
        suitabilityFilter: row.suitabilityFilter,
        popularityFilter: row.popularityFilter,
        minPrice: row.minPrice,
        maxPrice: row.maxPrice
      });
      if (!matchesAlertFilters(newProperty, filters, publicListings)) {
        return null;
      }
      return sendNewMatchingListingAlertEmail({
        toEmail: row.email,
        fullName: row.fullName,
        listingTitle: newProperty.title,
        listingLocation: newProperty.location,
        listingType: newProperty.type,
        listingPrice: newProperty.price,
        listingUrl,
        filterSummary: buildAlertFilterSummary(filters)
      });
    })
    .filter(Boolean);

  if (!sendJobs.length) return;
  await Promise.allSettled(sendJobs);
}

function buildUploadedFileUrl(req, file) {
  const protocol = req.protocol || "http";
  const host = req.get("host");
  const fileName = String(file?.filename || "").trim();
  if (!host || !fileName) return "";
  return `${protocol}://${host}/uploads/properties/${fileName}`;
}

function hasNonEmptyValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => String(item || "").trim() !== "");
  }
  return String(value || "").trim() !== "";
}

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function splitDuplicateUploadedFiles(files) {
  const seenHashes = new Set();
  const uniqueFiles = [];
  const duplicateFiles = [];

  for (const file of files) {
    const filePath = String(file?.path || "").trim();
    if (!filePath) continue;
    const hash = await computeFileHash(filePath);
    if (seenHashes.has(hash)) {
      duplicateFiles.push(file);
      continue;
    }
    seenHashes.add(hash);
    uniqueFiles.push(file);
  }

  return { uniqueFiles, duplicateFiles };
}

async function removeUploadedFiles(files) {
  const candidates = Array.isArray(files) ? files : [];
  await Promise.allSettled(
    candidates.map((file) => {
      const filePath = String(file?.path || "").trim();
      if (!filePath) return Promise.resolve();
      return fs.promises.unlink(filePath);
    })
  );
}

async function rejectDuplicateImageUploads(res, uploadedImages, uploadedVideo = null) {
  const filesToDelete = [
    ...uploadedImages,
    ...(uploadedVideo ? [uploadedVideo] : [])
  ];
  await removeUploadedFiles(filesToDelete);
  return res.status(400).json({
    message: "Duplicate image upload detected. Please upload each listing image only once."
  });
}

function parseMonths(rawValue, fallback = 1) {
  const numeric = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(numeric, 36);
}

function toMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function mapQuoteWithFx(pricingQuote, fxRate) {
  const rate = Number(fxRate?.rate || 0);
  return {
    ...pricingQuote,
    totalKes: toMoney(pricingQuote.totalUsd * rate),
    subtotalKes: toMoney(pricingQuote.subtotalUsd * rate),
    monthlyFeeKes: toMoney(pricingQuote.monthlyFeeUsd * rate),
    discountAmountKes: toMoney(pricingQuote.discountAmountUsd * rate)
  };
}

async function buildFxSummary() {
  const fxRate = await getUsdToKesRate();
  return {
    usdToKesRate: Number(fxRate.rate),
    fetchedAt: fxRate.fetchedAt,
    source: fxRate.source
  };
}

async function loadActivePricingRules(listingType) {
  const normalizedType = String(listingType || "").trim().toLowerCase();
  const [rows] = await pool.execute(
    `
      SELECT
        min_property_value AS minPropertyValue,
        max_property_value AS maxPropertyValue,
        monthly_fee_usd AS monthlyFeeUsd
      FROM listing_pricing_rules
      WHERE listing_type = ?
        AND is_active = 1
      ORDER BY min_property_value ASC, id ASC
    `,
    [normalizedType]
  );
  return rows;
}

async function loadActiveDurationDiscounts() {
  const [rows] = await pool.execute(
    `
      SELECT
        min_months AS minMonths,
        max_months AS maxMonths,
        discount_percent AS discountPercent
      FROM listing_duration_discounts
      WHERE is_active = 1
      ORDER BY min_months ASC, id ASC
    `
  );
  return rows;
}

function selectPricingRule(rules, propertyValue) {
  const normalizedValue = Number(propertyValue);
  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) return null;
  return rules.find((rule) => {
    const min = Number(rule.minPropertyValue);
    const max = rule.maxPropertyValue === null ? null : Number(rule.maxPropertyValue);
    if (!Number.isFinite(min)) return false;
    if (normalizedValue < min) return false;
    if (max !== null && Number.isFinite(max) && normalizedValue > max) return false;
    return true;
  }) || null;
}

function selectDurationDiscount(discounts, months) {
  return discounts.find((discount) => {
    const min = Number.parseInt(String(discount.minMonths), 10);
    const max = discount.maxMonths === null ? null : Number.parseInt(String(discount.maxMonths), 10);
    if (!Number.isInteger(min) || months < min) return false;
    if (max !== null && Number.isInteger(max) && months > max) return false;
    return true;
  }) || null;
}

async function buildPricingQuote({ listingType, propertyValue, months }) {
  const normalizedMonths = parseMonths(months, 1);
  const [rules, discounts] = await Promise.all([
    loadActivePricingRules(listingType),
    loadActiveDurationDiscounts()
  ]);

  const matchedRule = selectPricingRule(rules, propertyValue);
  const matchedDiscount = selectDurationDiscount(discounts, normalizedMonths);
  const monthlyFeeUsd = toMoney(matchedRule?.monthlyFeeUsd ?? PAYMENT_CONFIG.listingFeeAmountUsd);
  const discountPercent = toMoney(matchedDiscount?.discountPercent ?? 0);
  const subtotalUsd = toMoney(monthlyFeeUsd * normalizedMonths);
  const discountAmountUsd = toMoney(subtotalUsd * (discountPercent / 100));
  const totalUsd = toMoney(Math.max(0, subtotalUsd - discountAmountUsd));

  return {
    months: normalizedMonths,
    monthlyFeeUsd,
    subtotalUsd,
    discountPercent,
    discountAmountUsd,
    totalUsd
  };
}

async function buildPricingPreview(listingType, propertyValue) {
  const monthCandidates = [1, 3, 6, 12];
  const quotesByMonths = await Promise.all(
    monthCandidates.map((months) => buildPricingQuote({ listingType, propertyValue, months }))
  );
  return quotesByMonths;
}

async function buildPricingQuoteSafe({ listingType, propertyValue, months }) {
  try {
    return await buildPricingQuote({ listingType, propertyValue, months });
  } catch (_error) {
    const normalizedMonths = parseMonths(months, 1);
    const monthlyFeeUsd = toMoney(PAYMENT_CONFIG.listingFeeAmountUsd);
    const subtotalUsd = toMoney(monthlyFeeUsd * normalizedMonths);
    return {
      months: normalizedMonths,
      monthlyFeeUsd,
      subtotalUsd,
      discountPercent: 0,
      discountAmountUsd: 0,
      totalUsd: subtotalUsd
    };
  }
}

async function buildPricingPreviewSafe(listingType, propertyValue) {
  try {
    return await buildPricingPreview(listingType, propertyValue);
  } catch (_error) {
    return Promise.all([1, 3, 6, 12].map((months) => buildPricingQuoteSafe({
      listingType,
      propertyValue,
      months
    })));
  }
}

const getAllProperties = (req, res) => {
  enforceListingExpiryAcrossAll();
  const includeDeleted = isTruthyFlag(req.query?.includeDeleted);
  const isAdmin = hasModulePermission(req.session?.user, MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.VIEW);
  if (includeDeleted && isAdmin) {
    return res.status(200).json(properties.map((item) => ensurePropertyPaymentState(item)));
  }
  return res.status(200).json(
    properties
      .filter((item) => isVisibleToPublic(item))
      .map((item) => ensurePropertyPaymentState(item))
  );
};

const getMyProperties = (req, res) => {
  enforceListingExpiryAcrossAll();
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const accountType = String(sessionUser.accountType || "").toLowerCase();
  if (accountType !== "lister" && accountType !== "admin") {
    return res.status(403).json({ message: "Only lister or admin accounts can view personal listings." });
  }

  const ownerId = Number(sessionUser.id);
  if (!Number.isFinite(ownerId) || ownerId <= 0) {
    return res.status(400).json({ message: "Invalid session user." });
  }

  const data = properties
    .filter((item) => Number(item.ownerId) === ownerId)
    .map((item) => ensurePropertyPaymentState(item));
  return res.status(200).json(data);
};

const getPropertyById = async (req, res) => {
  enforceListingExpiryAcrossAll();
  const id = Number(req.params.id);
  const property = properties.find((item) => item.id === id);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }
  const sessionUser = req.session?.user;
  const canViewDraft = sessionUser && canAccessListing(sessionUser, property);
  if (isSoftDeleted(property) && !hasModulePermission(req.session?.user, MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.VIEW)) {
    return res.status(404).json({ message: "Property not found" });
  }
  if (!isPublishedListing(property) && !canViewDraft) {
    return res.status(404).json({ message: "Property not found" });
  }
  const viewTracked = await trackPropertyViewEvent(req, property);
  if (viewTracked) {
    emitListerMetricsUpdate(property.ownerId, property.id, "listing_viewed");
  }
  return res.status(200).json(ensurePropertyPaymentState(property));
};

const createProperty = async (req, res) => {
  const { title, location, type, price, description, ownerId, latitude, longitude } = req.body || {};
  const uploadedImages = Array.isArray(req.files?.images) ? req.files.images : [];
  const uploadedVideo = Array.isArray(req.files?.video) ? req.files.video[0] : null;
  const requestedIntent = normalizePaymentIntent(req.body?.paymentIntent);
  const wantsPrePublishPremium = requestedIntent === LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM;

  if (
    hasNonEmptyValue(req.body?.imageUrl) ||
    hasNonEmptyValue(req.body?.imageUrls) ||
    hasNonEmptyValue(req.body?.videoUrl)
  ) {
    return res.status(400).json({
      message: "Please upload media files from your device instead of providing media URLs."
    });
  }

  if (!title || !location || !type || price === undefined || price === null || !ownerId) {
    return res.status(400).json({
      message: "Title, location, type, price, and owner ID are required"
    });
  }

  const normalizedType = String(type).trim().toLowerCase();
  if (normalizedType !== "rent" && normalizedType !== "lease") {
    return res.status(400).json({
      message: "Type must be either 'rent' or 'lease'"
    });
  }

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({
      message: "Price must be a valid positive number"
    });
  }

  const normalizedDescription = String(description || "").trim();
  if (!normalizedDescription) {
    return res.status(400).json({
      message: "Description is required"
    });
  }

  const parsedLatitude = parseCoordinateOrNull(latitude);
  const parsedLongitude = parseCoordinateOrNull(longitude);
  const hasLatitudeInput = latitude !== undefined;
  const hasLongitudeInput = longitude !== undefined;
  if (hasLatitudeInput !== hasLongitudeInput) {
    return res.status(400).json({
      message: "Latitude and longitude must be provided together."
    });
  }
  if (Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude)) {
    return res.status(400).json({
      message: "Latitude and longitude must be valid numbers."
    });
  }

  let owner;
  try {
    const [rows] = await pool.execute(
      `
        SELECT id, account_type, phone, is_banned, suspended_until
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [Number(ownerId)]
    );
    owner = rows[0];
  } catch (_error) {
    return res.status(500).json({ message: "Could not verify listing owner" });
  }

  if (!owner || owner.account_type !== "lister") {
    return res.status(403).json({
      message: "Only lister accounts can create property listings"
    });
  }

  if (owner.is_banned) {
    return res.status(403).json({
      message: "Your account has been permanently banned. Listing creation is blocked."
    });
  }

  if (owner.suspended_until) {
    const suspendedUntil = new Date(owner.suspended_until);
    if (!Number.isNaN(suspendedUntil.getTime()) && suspendedUntil.getTime() > Date.now()) {
      return res.status(403).json({
        message: `Your account is suspended until ${suspendedUntil.toLocaleString("en-KE")}.`
      });
    }
  }

  const maxImages = wantsPrePublishPremium ? PAID_MAX_IMAGE_LIMIT : BASIC_INCLUDED_IMAGE_LIMIT;

  const { uniqueFiles: uniqueUploadedImages, duplicateFiles: duplicateUploadedImages } = await splitDuplicateUploadedFiles(uploadedImages);
  if (duplicateUploadedImages.length > 0) {
    return rejectDuplicateImageUploads(res, uploadedImages, uploadedVideo);
  }

  const sanitizedImages = uniqueUploadedImages
    .map((file) => buildUploadedFileUrl(req, file))
    .filter(Boolean);

  if (sanitizedImages.length === 0) {
    return res.status(400).json({
      message: "Please upload at least one listing image from your device."
    });
  }

  if (sanitizedImages.length > maxImages) {
    return res.status(400).json({
      message: `New listings include up to ${maxImages} images. Pay per listing to unlock more images and video.`
    });
  }

  const normalizedImageUrls = sanitizedImages;

  let normalizedVideoUrl = "";
  if (uploadedVideo) {
    if (!wantsPrePublishPremium) {
      return res.status(403).json({
        message: "Video upload is locked until listing payment is completed."
      });
    }
    normalizedVideoUrl = buildUploadedFileUrl(req, uploadedVideo);
  }

  const nextId = properties.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 0) + 1;
  const defaultBasicExpiry = addMonthsToDate(new Date(), 1).toISOString();
  const createdProperty = {
    id: nextId,
    title: String(title).trim(),
    location: String(location).trim(),
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    type: normalizedType,
    price: Math.round(numericPrice),
    description: normalizedDescription,
    imageUrl: normalizedImageUrls[0] || "",
    imageUrls: normalizedImageUrls,
    videoUrl: normalizedVideoUrl,
    ownerId: Number(owner.id),
    paymentStatus: PAYMENT_STATUS.UNPAID,
    premiumMediaUnlocked: false,
    includedImageLimit: BASIC_INCLUDED_IMAGE_LIMIT,
    listingStatus: wantsPrePublishPremium ? LISTING_STATUS.DRAFT : LISTING_STATUS.PUBLISHED,
    isPublished: !wantsPrePublishPremium,
    paymentIntent: wantsPrePublishPremium ? LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM : null,
    visibilityExpiresAt: wantsPrePublishPremium ? null : defaultBasicExpiry,
    isExpired: false,
    expiredAt: null,
    isSoftDeleted: false,
    deletedAt: null,
    deletedByUserId: null,
    deletionReason: null
  };

  properties.push(createdProperty);
  await syncPropertyToDatabase(createdProperty);
  void dispatchNewPropertyAlerts(createdProperty).catch((error) => {
    console.error("listing-alert-dispatch-failed:", error.message);
  });

  return res.status(201).json({
    message: wantsPrePublishPremium
      ? "Listing draft saved. Complete payment to publish with premium features."
      : "Property listing created successfully",
    property: ensurePropertyPaymentState(createdProperty),
    payment: {
      status: "unpaid",
      amount: (await buildPricingQuoteSafe({
        listingType: createdProperty.type,
        propertyValue: createdProperty.price,
        months: 1
      })).totalUsd,
      currency: "USD",
      recommendedProvider: inferRecommendedProvider(owner.phone)
    }
  });
};

async function getUserById(userId) {
  const [rows] = await pool.execute(
    `
      SELECT id, account_type, phone
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [Number(userId)]
  );
  return rows[0] || null;
}

function canAccessListing(sessionUser, property) {
  if (!sessionUser || !property) return false;
  if (sessionUser.accountType === "admin") return true;
  return Number(property.ownerId) === Number(sessionUser.id);
}

async function getLatestListingPayment(propertyId) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        property_id AS propertyId,
        user_id AS userId,
        amount,
        amount_kes AS amountKes,
        currency,
        provider,
        status,
        payment_method_label AS paymentMethodLabel,
        provider_ref AS providerRef,
        checkout_ref AS checkoutRef,
        receipt_number AS receiptNumber,
        receipt_issued_at AS receiptIssuedAt,
        paid_at AS paidAt,
        metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM listing_payments
      WHERE property_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [Number(propertyId)]
  );
  return rows[0] || null;
}

async function markListingPaid({ property, providerRef, checkoutRef, provider, metadata = null }) {
  await pool.execute(
    `
      UPDATE listing_payments
      SET
        status = 'paid',
        provider_ref = COALESCE(?, provider_ref),
        payment_method_label = COALESCE(payment_method_label, ?),
        receipt_number = COALESCE(receipt_number, CONCAT('KRE-', DATE_FORMAT(CURRENT_TIMESTAMP, '%Y%m%d'), '-', LPAD(id, 8, '0'))),
        receipt_issued_at = COALESCE(receipt_issued_at, CURRENT_TIMESTAMP),
        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
        metadata = COALESCE(?, metadata)
      WHERE checkout_ref = ?
    `,
    [providerRef || null, provider || null, metadata ? JSON.stringify(metadata) : null, checkoutRef]
  );
  const paymentIntent = normalizePaymentIntent(metadata?.paymentIntent);
  const months = parseMonths(metadata?.pricingQuote?.months ?? metadata?.months, 1);

  applyPaymentCycleToListing(property, months);
  property.includedImageLimit = BASIC_INCLUDED_IMAGE_LIMIT;
  property.paymentIntent = paymentIntent;
  if (providerRef) {
    property.lastPaymentReference = providerRef;
  }
  property.lastPaymentProvider = provider || property.lastPaymentProvider || null;
  await syncPropertyToDatabase(property);
}

async function applySuccessfulPaymentByReference({ checkoutRef, providerRef, provider, metadata = null }) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        property_id AS propertyId,
        provider,
        status,
        checkout_ref AS checkoutRef,
        metadata
      FROM listing_payments
      WHERE checkout_ref = ? OR provider_ref = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [checkoutRef || "", providerRef || ""]
  );

  const paymentRow = rows[0];
  if (!paymentRow) {
    return { updated: false, reason: "payment_not_found" };
  }

  const property = properties.find((item) => Number(item.id) === Number(paymentRow.propertyId));
  if (!property) {
    return { updated: false, reason: "property_not_found" };
  }

  ensurePropertyPaymentState(property);
  if (paymentRow.status === "paid" && property.premiumMediaUnlocked) {
    return { updated: false, reason: "already_paid", property };
  }

  const effectiveProvider = provider || paymentRow.provider || "mock";
  let paymentMetadata = {};
  try {
    if (paymentRow.metadata) {
      paymentMetadata = JSON.parse(paymentRow.metadata);
    }
  } catch (_error) {
    paymentMetadata = {};
  }
  await markListingPaid({
    property,
    providerRef,
    checkoutRef: paymentRow.checkoutRef,
    provider: effectiveProvider,
    metadata: {
      ...paymentMetadata,
      ...(metadata || {})
    }
  });
  return { updated: true, property };
}

const getListingPaymentStatus = async (req, res) => {
  enforceListingExpiryAcrossAll();
  const propertyId = Number(req.params.id);
  const property = properties.find((item) => Number(item.id) === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }

  const sessionUser = req.session?.user;
  if (!canAccessListing(sessionUser, property)) {
    return res.status(403).json({ message: "You are not allowed to view payment status for this listing" });
  }

  const owner = await getUserById(property.ownerId);
  const recommendedProvider = inferRecommendedProvider(owner?.phone);
  const latestPayment = await getLatestListingPayment(propertyId);
  let pricingByMonths = await buildPricingPreviewSafe(property.type, property.price);
  let fxSummary;
  try {
    fxSummary = await buildFxSummary();
    pricingByMonths = pricingByMonths.map((quote) => mapQuoteWithFx(quote, { rate: fxSummary.usdToKesRate }));
  } catch (_error) {
    return res.status(503).json({
      message: "Live USD to KES conversion is currently unavailable. Please try again shortly."
    });
  }
  const normalizedProperty = ensurePropertyPaymentState(property);
  applyListingExpiryState(normalizedProperty);

  return res.status(200).json({
    propertyId,
    paymentStatus: normalizedProperty.paymentStatus,
    premiumMediaUnlocked: Boolean(normalizedProperty.premiumMediaUnlocked),
    listingStatus: getListingStatus(normalizedProperty),
    isPublished: isPublishedListing(normalizedProperty),
    isExpired: Boolean(normalizedProperty.isExpired),
    visibilityExpiresAt: normalizedProperty.visibilityExpiresAt || null,
    expiredAt: normalizedProperty.expiredAt || null,
    includedImageLimit: Number(normalizedProperty.includedImageLimit || BASIC_INCLUDED_IMAGE_LIMIT),
    paidMaxImageLimit: PAID_MAX_IMAGE_LIMIT,
    listingFeeAmountUsd: Number(pricingByMonths?.[0]?.totalUsd || PAYMENT_CONFIG.listingFeeAmountUsd),
    listingFeeAmountKes: Number(pricingByMonths?.[0]?.totalKes || 0),
    pricingByMonths,
    exchangeRate: fxSummary,
    recommendedProvider,
    latestPayment
  });
};

const createListingPaymentCheckout = async (req, res) => {
  enforceListingExpiryAcrossAll();
  const propertyId = Number(req.params.id);
  const property = properties.find((item) => Number(item.id) === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }

  const sessionUser = req.session?.user;
  if (!canAccessListing(sessionUser, property)) {
    return res.status(403).json({ message: "You are not allowed to pay for this listing" });
  }

  ensurePropertyPaymentState(property);
  const paymentIntent = normalizePaymentIntent(req.body?.paymentIntent || property.paymentIntent);
  if (paymentIntent === LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM && isPublishedListing(property)) {
    return res.status(400).json({
      message: "This listing is already published. Use upgrade payment for premium unlock."
    });
  }

  const owner = await getUserById(property.ownerId);
  if (!owner) {
    return res.status(404).json({ message: "Listing owner not found" });
  }

  const provider = resolveProvider(req.body?.provider, owner.phone);
  let effectiveProvider = provider;
  const checkoutRef = buildCheckoutRef(provider);
  const months = parseMonths(req.body?.months, 1);
  const pricingQuoteBase = await buildPricingQuoteSafe({
    listingType: property.type,
    propertyValue: property.price,
    months
  });
  let fxSummary;
  try {
    fxSummary = await buildFxSummary();
  } catch (_error) {
    return res.status(503).json({
      message: "Live USD to KES conversion is currently unavailable. Please try again shortly."
    });
  }
  const pricingQuote = mapQuoteWithFx(pricingQuoteBase, { rate: fxSummary.usdToKesRate });
  const amountUsd = pricingQuote.totalUsd;

  let providerResult;
  try {
    if (provider === "stripe" && PAYMENT_CONFIG.stripe.secretKey) {
      providerResult = await createStripeCheckout({
        checkoutRef,
        listingTitle: property.title,
        propertyId,
        userId: owner.id,
        amountUsd
      });
    } else if (provider === "mpesa" && PAYMENT_CONFIG.mpesa.consumerKey) {
      providerResult = await createMpesaCheckout({
        checkoutRef,
        listingTitle: property.title,
        phoneNumber: owner.phone,
        amountUsd
      });
    } else {
      effectiveProvider = "mock";
      providerResult = {
        checkoutRef,
        providerRef: `mock_${checkoutRef}`,
        checkoutUrl: null,
        metadata: { mode: "mock" }
      };
      if (PAYMENT_CONFIG.mockAutoSuccess) {
        applyPaymentCycleToListing(property, months);
        property.paymentIntent = paymentIntent;
      } else {
        property.paymentStatus = PAYMENT_STATUS.PENDING;
      }
    }
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Could not start payment checkout"
    });
  }

  const paymentStatus = (effectiveProvider === "mock" && PAYMENT_CONFIG.mockAutoSuccess) ? "paid" : "pending";
  await pool.execute(
    `
      INSERT INTO listing_payments (
        property_id,
        user_id,
        amount,
        amount_kes,
        currency,
        provider,
        status,
        payment_method_label,
        provider_ref,
        checkout_ref,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      propertyId,
      owner.id,
      amountUsd,
      Number.isFinite(Number(pricingQuote.totalKes)) ? Number(pricingQuote.totalKes) : null,
      "USD",
      effectiveProvider,
      paymentStatus,
      effectiveProvider,
      providerResult.providerRef || null,
      providerResult.checkoutRef || checkoutRef,
      JSON.stringify({
        ...(providerResult.metadata || {}),
        paymentIntent,
        months,
        pricingQuote
      })
    ]
  );

  if (paymentStatus === "paid") {
    applyPaymentCycleToListing(property, months);
    property.paymentIntent = paymentIntent;
  } else {
    property.paymentStatus = PAYMENT_STATUS.PENDING;
  }
  await syncPropertyToDatabase(property);

  return res.status(200).json({
    message: paymentStatus === "paid"
      ? "Payment marked successful in mock mode."
      : "Payment initiated successfully.",
    paymentStatus: property.paymentStatus,
    premiumMediaUnlocked: Boolean(property.premiumMediaUnlocked),
    listingStatus: getListingStatus(property),
    isPublished: isPublishedListing(property),
    isExpired: Boolean(property.isExpired),
    visibilityExpiresAt: property.visibilityExpiresAt || null,
    expiredAt: property.expiredAt || null,
    provider: effectiveProvider,
    pricingQuote,
    exchangeRate: fxSummary,
    checkoutRef: providerResult.checkoutRef || checkoutRef,
    checkoutUrl: providerResult.checkoutUrl || null
  });
};

const updateProperty = async (req, res) => {
  const propertyId = Number(req.params.id);
  const property = properties.find((item) => Number(item.id) === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }

  const sessionUser = req.session?.user;
  if (!canAccessListing(sessionUser, property)) {
    return res.status(403).json({ message: "You are not allowed to edit this listing" });
  }

  ensurePropertyPaymentState(property);
  const isPaid = property.paymentStatus === "paid" && Boolean(property.premiumMediaUnlocked);
  const allowedImageLimit = isPaid ? PAID_MAX_IMAGE_LIMIT : Number(property.includedImageLimit || BASIC_INCLUDED_IMAGE_LIMIT);

  const {
    title,
    location,
    latitude,
    longitude,
    type,
    price,
    description
  } = req.body || {};
  const uploadedImages = Array.isArray(req.files?.images) ? req.files.images : [];
  const uploadedVideo = Array.isArray(req.files?.video) ? req.files.video[0] : null;

  if (
    hasNonEmptyValue(req.body?.imageUrl) ||
    hasNonEmptyValue(req.body?.imageUrls) ||
    hasNonEmptyValue(req.body?.videoUrl)
  ) {
    return res.status(400).json({
      message: "Please upload media files from your device instead of providing media URLs."
    });
  }

  if (title !== undefined) property.title = String(title).trim() || property.title;
  if (location !== undefined) property.location = String(location).trim() || property.location;
  const hasLatitudeInput = latitude !== undefined;
  const hasLongitudeInput = longitude !== undefined;
  if (hasLatitudeInput !== hasLongitudeInput) {
    return res.status(400).json({ message: "Latitude and longitude must be provided together." });
  }
  if (hasLatitudeInput && hasLongitudeInput) {
    const parsedLatitude = parseCoordinateOrNull(latitude);
    const parsedLongitude = parseCoordinateOrNull(longitude);
    if (Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude)) {
      return res.status(400).json({ message: "Latitude and longitude must be valid numbers." });
    }
    property.latitude = parsedLatitude;
    property.longitude = parsedLongitude;
  }
  if (type !== undefined) {
    const normalizedType = String(type).trim().toLowerCase();
    if (normalizedType !== "rent" && normalizedType !== "lease") {
      return res.status(400).json({ message: "Type must be either 'rent' or 'lease'" });
    }
    property.type = normalizedType;
  }
  if (price !== undefined) {
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ message: "Price must be a valid positive number" });
    }
    property.price = Math.round(numericPrice);
  }
  if (description !== undefined) {
    const normalizedDescription = String(description || "").trim();
    if (!normalizedDescription) {
      return res.status(400).json({ message: "Description is required" });
    }
    property.description = normalizedDescription;
  }

  const { uniqueFiles: uniqueUploadedImages, duplicateFiles: duplicateUploadedImages } = await splitDuplicateUploadedFiles(uploadedImages);
  if (duplicateUploadedImages.length > 0) {
    return rejectDuplicateImageUploads(res, uploadedImages, uploadedVideo);
  }

  const sanitizedImages = uniqueUploadedImages
    .map((file) => buildUploadedFileUrl(req, file))
    .filter(Boolean);

  if (sanitizedImages.length > 0 && sanitizedImages.length > allowedImageLimit) {
    return res.status(400).json({
      message: isPaid
        ? `Paid listings support up to ${allowedImageLimit} images`
        : `Unpaid listings support up to ${allowedImageLimit} images. Complete payment to unlock more.`
    });
  }

  if (sanitizedImages.length > 0) {
    property.imageUrls = sanitizedImages;
    property.imageUrl = property.imageUrls[0] || "";
  }

  if (uploadedVideo) {
    if (!isPaid) {
      return res.status(403).json({
        message: "Video is locked until listing payment is completed."
      });
    }
    property.videoUrl = buildUploadedFileUrl(req, uploadedVideo);
  }

  await syncPropertyToDatabase(property);

  return res.status(200).json({
    message: "Listing updated successfully",
    property: ensurePropertyPaymentState(property)
  });
};

const submitPropertyInquiry = (req, res) => {
  req.params.propertyId = req.params.id;
  return createListingInquiryConversation(req, res);
};

const getMyPropertyAlertPreference = async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  try {
    const preference = await loadUserAlertPreference(userId);
    return res.status(200).json(preference);
  } catch (_error) {
    return res.status(500).json({ message: "Could not load listing alert preference right now." });
  }
};

const upsertMyPropertyAlertPreference = async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const enabled = Boolean(req.body?.enabled);
  const filters = normalizeAlertFilters(req.body?.filters || {});
  try {
    await pool.execute(
      `
        INSERT INTO property_alert_preferences (
          user_id,
          is_enabled,
          search_term,
          location_filter,
          type_filter,
          bedroom_filter,
          suitability_filter,
          popularity_filter,
          min_price,
          max_price
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          is_enabled = VALUES(is_enabled),
          search_term = VALUES(search_term),
          location_filter = VALUES(location_filter),
          type_filter = VALUES(type_filter),
          bedroom_filter = VALUES(bedroom_filter),
          suitability_filter = VALUES(suitability_filter),
          popularity_filter = VALUES(popularity_filter),
          min_price = VALUES(min_price),
          max_price = VALUES(max_price)
      `,
      [
        Number(userId),
        enabled ? 1 : 0,
        filters.searchTerm || null,
        filters.locationFilter || null,
        filters.typeFilter,
        filters.bedroomFilter,
        filters.suitabilityFilter,
        filters.popularityFilter,
        filters.minPrice,
        filters.maxPrice
      ]
    );

    return res.status(200).json({
      enabled,
      filters
    });
  } catch (_error) {
    return res.status(500).json({ message: "Could not save listing alert preference right now." });
  }
};

const getShortlistedProperties = async (req, res) => {
  enforceListingExpiryAcrossAll();
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  try {
    const [rows] = await pool.execute(
      `
        SELECT property_id AS propertyId
        FROM property_shortlists
        WHERE user_id = ?
        ORDER BY created_at DESC
      `,
      [userId]
    );

    const shortlistedPropertyIds = rows
      .map((row) => Number(row.propertyId))
      .filter((value) => Number.isFinite(value));
    const shortlistedLookup = new Set(shortlistedPropertyIds);
    const isAdmin = req.session?.user?.accountType === "admin";
    const data = properties.filter((item) => {
      const propertyId = Number(item.id);
      if (!shortlistedLookup.has(propertyId)) return false;
      if (isAdmin) return true;
      return isVisibleToPublic(item);
    });

    return res.status(200).json({
      propertyIds: shortlistedPropertyIds,
      data
    });
  } catch (_error) {
    return res.status(500).json({ message: "Could not load shortlist right now." });
  }
};

const getMyListingEngagement = async (req, res) => {
  enforceListingExpiryAcrossAll();
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const accountType = String(sessionUser.accountType || "").toLowerCase();
  if (accountType !== "lister" && accountType !== "admin") {
    return res.status(403).json({ message: "Only lister or admin accounts can view engagement analytics." });
  }

  const ownerUserId = Number(sessionUser.id);
  if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) {
    return res.status(400).json({ message: "Invalid session user." });
  }

  const ownedProperties = properties
    .filter((item) => Number(item.ownerId) === ownerUserId && !isSoftDeleted(item))
    .map((item) => ensurePropertyPaymentState(item));
  const propertyIds = ownedProperties
    .map((item) => Number(item.id))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (propertyIds.length === 0) {
    return res.status(200).json({
      totals: {
        views: 0,
        interestedShortlist: 0,
        interestedInquiry: 0,
        reachedOut: 0
      },
      listings: [],
      generatedAt: new Date().toISOString()
    });
  }

  const inClause = propertyIds.map(() => "?").join(", ");
  const viewsByPropertyId = new Map();
  const shortlistByPropertyId = new Map();
  const inquiryByPropertyId = new Map();
  const reachedOutByPropertyId = new Map();

  try {
    const [viewRows] = await pool.execute(
      `
        SELECT
          property_id AS propertyId,
          COUNT(*) AS viewCount
        FROM listing_view_events
        WHERE owner_user_id = ?
          AND property_id IN (${inClause})
        GROUP BY property_id
      `,
      [ownerUserId, ...propertyIds]
    );
    viewRows.forEach((row) => {
      viewsByPropertyId.set(Number(row.propertyId), Number(row.viewCount || 0));
    });

    const [shortlistRows] = await pool.execute(
      `
        SELECT
          property_id AS propertyId,
          COUNT(DISTINCT user_id) AS interestedShortlist
        FROM property_shortlists
        WHERE property_id IN (${inClause})
          AND user_id <> ?
        GROUP BY property_id
      `,
      [...propertyIds, ownerUserId]
    );
    shortlistRows.forEach((row) => {
      shortlistByPropertyId.set(Number(row.propertyId), Number(row.interestedShortlist || 0));
    });

    const [inquiryRows] = await pool.execute(
      `
        SELECT
          property_id AS propertyId,
          COUNT(DISTINCT viewer_user_id) AS interestedInquiry
        FROM listing_conversations
        WHERE lister_user_id = ?
          AND property_id IN (${inClause})
        GROUP BY property_id
      `,
      [ownerUserId, ...propertyIds]
    );
    inquiryRows.forEach((row) => {
      inquiryByPropertyId.set(Number(row.propertyId), Number(row.interestedInquiry || 0));
    });

    const [reachedOutRows] = await pool.execute(
      `
        SELECT
          c.property_id AS propertyId,
          COUNT(DISTINCT lm.sender_user_id) AS reachedOut
        FROM listing_conversations c
        INNER JOIN listing_messages lm
          ON lm.conversation_id = c.id
          AND lm.sender_user_id = c.viewer_user_id
        WHERE c.lister_user_id = ?
          AND c.property_id IN (${inClause})
        GROUP BY c.property_id
      `,
      [ownerUserId, ...propertyIds]
    );
    reachedOutRows.forEach((row) => {
      reachedOutByPropertyId.set(Number(row.propertyId), Number(row.reachedOut || 0));
    });
  } catch (_error) {
    return res.status(500).json({ message: "Could not load listing engagement right now." });
  }

  const listings = ownedProperties.map((item) => {
    const propertyId = Number(item.id);
    return {
      propertyId,
      title: item.title,
      location: item.location,
      listingStatus: getListingStatus(item),
      views: viewsByPropertyId.get(propertyId) || 0,
      interestedShortlist: shortlistByPropertyId.get(propertyId) || 0,
      interestedInquiry: inquiryByPropertyId.get(propertyId) || 0,
      reachedOut: reachedOutByPropertyId.get(propertyId) || 0
    };
  });

  const totals = listings.reduce((acc, item) => ({
    views: acc.views + Number(item.views || 0),
    interestedShortlist: acc.interestedShortlist + Number(item.interestedShortlist || 0),
    interestedInquiry: acc.interestedInquiry + Number(item.interestedInquiry || 0),
    reachedOut: acc.reachedOut + Number(item.reachedOut || 0)
  }), {
    views: 0,
    interestedShortlist: 0,
    interestedInquiry: 0,
    reachedOut: 0
  });

  return res.status(200).json({
    totals,
    listings,
    generatedAt: new Date().toISOString()
  });
};

const addPropertyToShortlist = async (req, res) => {
  enforceListingExpiryAcrossAll();
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const propertyId = Number(req.params.id);
  if (!Number.isFinite(propertyId)) {
    return res.status(400).json({ message: "Invalid property ID." });
  }

  const property = properties.find((item) => Number(item.id) === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found." });
  }
  if ((!isVisibleToPublic(property)) && !hasModulePermission(req.session?.user, MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.VIEW)) {
    return res.status(404).json({ message: "Property not found." });
  }

  try {
    await pool.execute(
      `
        INSERT IGNORE INTO property_shortlists (user_id, property_id)
        VALUES (?, ?)
      `,
      [userId, propertyId]
    );
    if (Number(property.ownerId) !== Number(userId)) {
      emitListerMetricsUpdate(property.ownerId, propertyId, "shortlist_added");
    }
    return res.status(200).json({ message: "Property added to shortlist." });
  } catch (_error) {
    return res.status(500).json({ message: "Could not update shortlist right now." });
  }
};

const removePropertyFromShortlist = async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const propertyId = Number(req.params.id);
  if (!Number.isFinite(propertyId)) {
    return res.status(400).json({ message: "Invalid property ID." });
  }

  try {
    await pool.execute(
      `
        DELETE FROM property_shortlists
        WHERE user_id = ? AND property_id = ?
      `,
      [userId, propertyId]
    );
    const property = properties.find((item) => Number(item.id) === propertyId);
    if (property && Number(property.ownerId) !== Number(userId)) {
      emitListerMetricsUpdate(property.ownerId, propertyId, "shortlist_removed");
    }
    return res.status(200).json({ message: "Property removed from shortlist." });
  } catch (_error) {
    return res.status(500).json({ message: "Could not update shortlist right now." });
  }
};

const softDeleteProperty = (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (!hasModulePermission(sessionUser, MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.MANAGE)) {
    return res.status(403).json({ message: "You do not have permission to moderate listings." });
  }

  const propertyId = Number(req.params.id);
  const property = properties.find((item) => item.id === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }

  if (isSoftDeleted(property)) {
    return res.status(400).json({ message: "Listing is already soft deleted" });
  }

  const reason = String(req.body?.reason || "reported_false_listing").trim() || "reported_false_listing";
  property.isSoftDeleted = true;
  property.deletedAt = new Date().toISOString();
  property.deletedByUserId = Number(sessionUser.id) || null;
  property.deletionReason = reason;
  void syncPropertyToDatabase(property);

  return res.status(200).json({
    message: "Listing soft deleted successfully",
    property: {
      ...property,
      moderation: buildRestrictionContext(property)
    }
  });
};

function applySoftDeleteFromModeration(propertyId, adminUserId, reason) {
  const id = Number(propertyId);
  const property = properties.find((item) => Number(item.id) === id);
  if (!property) {
    return { ok: false, error: "not_found" };
  }
  if (isSoftDeleted(property)) {
    return { ok: true, alreadyApplied: true, property };
  }
  const normalizedReason = String(reason || "listing_report").trim() || "listing_report";
  property.isSoftDeleted = true;
  property.deletedAt = new Date().toISOString();
  property.deletedByUserId = Number(adminUserId) > 0 ? Number(adminUserId) : null;
  property.deletionReason = normalizedReason;
  void syncPropertyToDatabase(property);
  return { ok: true, alreadyApplied: false, property };
}

const restoreSoftDeletedProperty = (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (!hasModulePermission(sessionUser, MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.MANAGE)) {
    return res.status(403).json({ message: "You do not have permission to moderate listings." });
  }

  const propertyId = Number(req.params.id);
  const property = properties.find((item) => item.id === propertyId);
  if (!property) {
    return res.status(404).json({ message: "Property not found" });
  }
  if (!isSoftDeleted(property)) {
    return res.status(400).json({ message: "Listing is not soft deleted" });
  }

  property.isSoftDeleted = false;
  property.deletedAt = null;
  property.deletedByUserId = null;
  property.deletionReason = null;
  void syncPropertyToDatabase(property);

  return res.status(200).json({
    message: "Listing restored successfully",
    property: {
      ...property,
      moderation: buildRestrictionContext(property)
    }
  });
};

module.exports = {
  getAllProperties,
  getMyProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  getListingPaymentStatus,
  createListingPaymentCheckout,
  applySuccessfulPaymentByReference,
  submitPropertyInquiry,
  getMyPropertyAlertPreference,
  upsertMyPropertyAlertPreference,
  getShortlistedProperties,
  getMyListingEngagement,
  addPropertyToShortlist,
  removePropertyFromShortlist,
  softDeleteProperty,
  restoreSoftDeletedProperty,
  applySoftDeleteFromModeration
};
