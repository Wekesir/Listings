function readStringEnv(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function readNumberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PAYMENT_CONFIG = {
  listingFeeAmountUsd: readNumberEnv(process.env.LISTING_FEE_AMOUNT_USD, 19),
  basicIncludedImageLimit: readNumberEnv(process.env.LISTING_BASIC_IMAGE_LIMIT, 2),
  paidMaxImageLimit: readNumberEnv(process.env.LISTING_PAID_MAX_IMAGE_LIMIT, 12),
  mockAutoSuccess: readStringEnv(process.env.PAYMENTS_MOCK_AUTO_SUCCESS, "true").toLowerCase() !== "false",
  stripe: {
    secretKey: readStringEnv(process.env.STRIPE_SECRET_KEY, ""),
    webhookSecret: readStringEnv(process.env.STRIPE_WEBHOOK_SECRET, ""),
    successUrl: readStringEnv(process.env.STRIPE_SUCCESS_URL, "http://localhost:5173/listings?payment=success"),
    cancelUrl: readStringEnv(process.env.STRIPE_CANCEL_URL, "http://localhost:5173/listings?payment=cancelled")
  },
  mpesa: {
    consumerKey: readStringEnv(process.env.MPESA_CONSUMER_KEY, ""),
    consumerSecret: readStringEnv(process.env.MPESA_CONSUMER_SECRET, ""),
    passkey: readStringEnv(process.env.MPESA_PASSKEY, ""),
    shortcode: readStringEnv(process.env.MPESA_SHORTCODE, ""),
    callbackUrl: readStringEnv(process.env.MPESA_CALLBACK_URL, ""),
    baseUrl: readStringEnv(process.env.MPESA_BASE_URL, "https://sandbox.safaricom.co.ke")
  },
  fx: {
    endpoint: readStringEnv(process.env.FX_USD_KES_ENDPOINT, "https://open.er-api.com/v6/latest/USD"),
    providerName: readStringEnv(process.env.FX_USD_KES_PROVIDER_NAME, "open-er-api"),
    timeoutMs: readNumberEnv(process.env.FX_TIMEOUT_MS, 5000),
    cacheTtlMs: readNumberEnv(process.env.FX_CACHE_TTL_MS, 5 * 60 * 1000)
  }
};

module.exports = {
  PAYMENT_CONFIG
};
