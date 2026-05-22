const analyticsEvents = require("../data/analyticsEvents");

const ALLOWED_EVENTS = new Set([
  "premium_upgrade_cta_clicked"
]);

const trackEvent = (req, res) => {
  const { eventName, metadata } = req.body || {};

  if (!eventName || !ALLOWED_EVENTS.has(String(eventName))) {
    return res.status(400).json({
      message: "Invalid event name"
    });
  }

  const event = {
    id: analyticsEvents.length + 1,
    eventName: String(eventName),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    createdAt: new Date().toISOString()
  };

  analyticsEvents.push(event);

  return res.status(201).json({
    message: "Event tracked",
    eventId: event.id
  });
};

const getAnalyticsSummary = (req, res) => {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

  const countsByEvent = analyticsEvents.reduce((acc, event) => {
    const key = String(event.eventName || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const last24hCount = analyticsEvents.filter((event) => {
    const createdAt = Date.parse(event.createdAt);
    return Number.isFinite(createdAt) && createdAt >= twentyFourHoursAgo;
  }).length;

  const last7dCount = analyticsEvents.filter((event) => {
    const createdAt = Date.parse(event.createdAt);
    return Number.isFinite(createdAt) && createdAt >= sevenDaysAgo;
  }).length;

  const premiumUpgradeCtaClicks = countsByEvent.premium_upgrade_cta_clicked || 0;

  return res.status(200).json({
    totals: {
      allEvents: analyticsEvents.length,
      premiumUpgradeCtaClicks
    },
    windows: {
      last24h: last24hCount,
      last7d: last7dCount
    },
    countsByEvent,
    updatedAt: new Date().toISOString()
  });
};

module.exports = {
  trackEvent,
  getAnalyticsSummary
};
