const express = require("express");
const { trackEvent, getAnalyticsSummary } = require("../controllers/analyticsController");

const router = express.Router();

router.post("/events", trackEvent);
router.get("/summary", getAnalyticsSummary);

module.exports = router;
