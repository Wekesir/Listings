const express = require("express");
const {
  handleStripeWebhook,
  handleMpesaCallback
} = require("../controllers/paymentController");

const router = express.Router();

router.post("/stripe/webhook", handleStripeWebhook);
router.post("/mpesa/callback", handleMpesaCallback);

module.exports = router;
