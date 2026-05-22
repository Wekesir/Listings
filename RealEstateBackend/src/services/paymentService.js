const crypto = require("crypto");
const { PAYMENT_CONFIG } = require("../config/payments");
const { getUsdToKesRate } = require("./fxService");

function normalizePhoneNumber(rawPhone) {
  const phone = String(rawPhone || "").replace(/\s+/g, "").trim();
  if (!phone) return "";
  if (phone.startsWith("+")) return phone.slice(1);
  return phone;
}

function isKenyanPhone(rawPhone) {
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) return false;
  return (
    phone.startsWith("254") ||
    phone.startsWith("07") ||
    phone.startsWith("01")
  );
}

function inferRecommendedProvider(rawPhone) {
  return isKenyanPhone(rawPhone) ? "mpesa" : "stripe";
}

function resolveProvider(preferredProvider, rawPhone) {
  const normalized = String(preferredProvider || "").trim().toLowerCase();
  if (normalized === "mpesa" || normalized === "stripe") return normalized;
  return inferRecommendedProvider(rawPhone);
}

function buildCheckoutRef(prefix = "lp") {
  const random = crypto.randomBytes(5).toString("hex");
  return `${prefix}_${Date.now()}_${random}`;
}

function mapPhoneForMpesa(rawPhone) {
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) return "";
  if (phone.startsWith("254")) return phone;
  if (phone.startsWith("0")) return `254${phone.slice(1)}`;
  return phone;
}

async function createStripeCheckout({
  checkoutRef,
  listingTitle,
  propertyId,
  userId,
  amountUsd
}) {
  if (!PAYMENT_CONFIG.stripe.secretKey) {
    throw new Error("Stripe is not configured");
  }
  // Lazy import keeps boot lightweight and avoids requiring Stripe when not used.
  // eslint-disable-next-line global-require
  const Stripe = require("stripe");
  const stripe = new Stripe(PAYMENT_CONFIG.stripe.secretKey);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: PAYMENT_CONFIG.stripe.successUrl,
    cancel_url: PAYMENT_CONFIG.stripe.cancelUrl,
    payment_method_types: ["card"],
    metadata: {
      checkoutRef,
      propertyId: String(propertyId),
      userId: String(userId)
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(amountUsd * 100),
          product_data: {
            name: `KenReal Listing Payment #${propertyId}`,
            description: `${listingTitle} - unlock premium media`
          }
        }
      }
    ]
  });

  return {
    checkoutRef,
    providerRef: session.id,
    checkoutUrl: session.url
  };
}

function buildMpesaTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

async function getMpesaAccessToken() {
  const { consumerKey, consumerSecret, baseUrl } = PAYMENT_CONFIG.mpesa;
  if (!consumerKey || !consumerSecret) {
    throw new Error("MPESA credentials are not configured");
  }
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`
    }
  });
  const payload = await response.json();
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.errorMessage || "Failed to obtain MPESA access token");
  }
  return payload.access_token;
}

async function createMpesaCheckout({
  checkoutRef,
  listingTitle,
  phoneNumber,
  amountUsd
}) {
  const { passkey, shortcode, callbackUrl, baseUrl } = PAYMENT_CONFIG.mpesa;
  if (!passkey || !shortcode || !callbackUrl) {
    throw new Error("MPESA configuration is incomplete");
  }

  const normalizedPhone = mapPhoneForMpesa(phoneNumber);
  if (!normalizedPhone) {
    throw new Error("A valid phone number is required for MPESA checkout");
  }

  const token = await getMpesaAccessToken();
  const timestamp = buildMpesaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  const fx = await getUsdToKesRate();
  const convertedKesAmount = Math.max(1, Math.round(amountUsd * Number(fx.rate || 0)));

  const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: convertedKesAmount,
      PartyA: normalizedPhone,
      PartyB: shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: callbackUrl,
      AccountReference: checkoutRef.slice(0, 12),
      TransactionDesc: `Listing ${listingTitle}`.slice(0, 180)
    })
  });
  const payload = await response.json();
  if (!response.ok || payload?.ResponseCode !== "0") {
    throw new Error(payload?.errorMessage || payload?.errorCode || "Failed to initiate MPESA checkout");
  }

  return {
    checkoutRef,
    providerRef: payload.CheckoutRequestID,
    checkoutUrl: null,
    metadata: payload
  };
}

module.exports = {
  PAYMENT_CONFIG,
  inferRecommendedProvider,
  resolveProvider,
  buildCheckoutRef,
  createStripeCheckout,
  createMpesaCheckout
};
