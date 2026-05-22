const { PAYMENT_CONFIG } = require("../config/payments");

const FX_CACHE_TTL_MS = Math.max(30 * 1000, Number(PAYMENT_CONFIG.fx.cacheTtlMs || 5 * 60 * 1000));
let fxCache = null;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapPayloadToRate(payload) {
  const kesRate = toNumber(payload?.rates?.KES);
  if (!kesRate || kesRate <= 0) return null;
  return {
    rate: kesRate,
    fetchedAt: new Date().toISOString(),
    source: PAYMENT_CONFIG.fx.providerName || "open-er-api"
  };
}

async function fetchFxRateFromProvider() {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(PAYMENT_CONFIG.fx.timeoutMs || 5000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(PAYMENT_CONFIG.fx.endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || "Unable to load exchange rates right now.");
    }

    const mapped = mapPayloadToRate(payload);
    if (!mapped) {
      throw new Error("Exchange rate provider did not return a valid USD/KES rate.");
    }
    return mapped;
  } finally {
    clearTimeout(timeout);
  }
}

async function getUsdToKesRate() {
  const now = Date.now();
  if (fxCache && (now - fxCache.cachedAtMs) < FX_CACHE_TTL_MS) {
    return fxCache.value;
  }

  const value = await fetchFxRateFromProvider();
  fxCache = {
    value,
    cachedAtMs: now
  };
  return value;
}

module.exports = {
  getUsdToKesRate
};
