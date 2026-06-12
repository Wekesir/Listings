const { PAYMENT_CONFIG } = require("../config/payments");
const { applySuccessfulPaymentByReference } = require("./propertyController");

async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    if (PAYMENT_CONFIG.stripe.secretKey && PAYMENT_CONFIG.stripe.webhookSecret && signature) {
      const Stripe = require("stripe");
      const stripe = new Stripe(PAYMENT_CONFIG.stripe.secretKey);
      event = stripe.webhooks.constructEvent(req.body, signature, PAYMENT_CONFIG.stripe.webhookSecret);
    } else {
      const payload = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "{}");
      event = JSON.parse(payload);
    }
  } catch (error) {
    return res.status(400).json({
      message: `Invalid Stripe webhook payload: ${error.message}`
    });
  }

  if (event?.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    const checkoutRef = session.metadata?.checkoutRef || null;
    const providerRef = session.id || null;

    try {
      await applySuccessfulPaymentByReference({
        checkoutRef,
        providerRef,
        provider: "stripe",
        metadata: {
          eventId: event.id || null,
          amountTotal: session.amount_total || null,
          currency: session.currency || null
        }
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Could not process Stripe event" });
    }
  }

  return res.status(200).json({ received: true });
}

async function handleMpesaCallback(req, res) {
  const callback = req.body?.Body?.stkCallback || req.body?.stkCallback || null;
  if (!callback) {
    return res.status(400).json({ message: "Invalid MPESA callback payload" });
  }

  const resultCode = Number(callback.ResultCode);
  if (resultCode !== 0) {
    return res.status(200).json({ received: true, status: "ignored_non_success" });
  }

  const checkoutRef = callback.CheckoutRequestID || null;
  const providerRef = callback.MerchantRequestID || callback.CheckoutRequestID || null;
  const metadataItems = Array.isArray(callback?.CallbackMetadata?.Item)
    ? callback.CallbackMetadata.Item
    : [];
  const metadata = {};
  metadataItems.forEach((entry) => {
    if (entry?.Name) metadata[entry.Name] = entry.Value;
  });

  try {
    await applySuccessfulPaymentByReference({
      checkoutRef,
      providerRef,
      provider: "mpesa",
      metadata
    });
    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not process MPESA callback" });
  }
}

module.exports = {
  handleStripeWebhook,
  handleMpesaCallback
};
