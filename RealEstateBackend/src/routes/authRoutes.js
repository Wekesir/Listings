const express = require("express");
const {
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
} = require("../controllers/authController");
const { passport } = require("../services/auth/passport");
const {
  getAdminListingReports,
  resolveListingReport
} = require("../controllers/listingReportController");
const ensureDbConnection = require("../middleware/ensureDbConnection");

const router = express.Router();

router.use(ensureDbConnection);

function ensureOAuthStrategy(strategyName) {
  return (_req, res, next) => {
    if (!passport._strategy(strategyName)) {
      return res.status(503).json({
        message: `${strategyName} OAuth is not configured on the server.`
      });
    }
    return next();
  };
}

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-email-code", verifyEmailCode);
router.post("/resend-verification-code", resendVerificationCode);
router.post("/logout", logoutUser);
router.get("/session", getSessionUser);
router.get("/audit-logs", getAuthAuditLogs);
router.post("/audit-logs/delete", deleteAuthAuditLogs);
router.get("/listing-pricing", getListingPricingConfiguration);
router.put("/listing-pricing", updateListingPricingConfiguration);
router.get("/users", getManageableUsers);
router.get("/listing-reports", getAdminListingReports);
router.patch("/listing-reports/:reportId", resolveListingReport);
router.post("/users/admin", createAdminUser);
router.post("/users/:userId/suspend", suspendUserAccount);
router.post("/users/:userId/ban", banUserAccount);
router.post("/users/:userId/clear-restrictions", clearUserRestrictions);
router.get("/email-delivery", getEmailDeliveryConfiguration);
router.put("/email-delivery", updateEmailDeliveryConfiguration);
router.put("/profile", updateProfile);
router.get("/oauth/providers", (_req, res) => {
  const googleConfigured = Boolean(passport._strategy("google"));
  const appleConfigured = Boolean(passport._strategy("apple"));
  return res.status(200).json({
    google: googleConfigured,
    apple: appleConfigured
  });
});
router.get(
  "/oauth/google",
  ensureOAuthStrategy("google"),
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account"
  })
);
router.get(
  "/oauth/google/callback",
  ensureOAuthStrategy("google"),
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/api/auth/oauth/failure?provider=google"
  }),
  handleOAuthCallback
);
router.get(
  "/oauth/apple",
  ensureOAuthStrategy("apple"),
  passport.authenticate("apple", {
    session: false,
    scope: ["name", "email"]
  })
);
router.get(
  "/oauth/apple/callback",
  ensureOAuthStrategy("apple"),
  passport.authenticate("apple", {
    session: false,
    failureRedirect: "/api/auth/oauth/failure?provider=apple"
  }),
  handleOAuthCallback
);
router.post(
  "/oauth/apple/callback",
  ensureOAuthStrategy("apple"),
  passport.authenticate("apple", {
    session: false,
    failureRedirect: "/api/auth/oauth/failure?provider=apple"
  }),
  handleOAuthCallback
);
router.get("/oauth/failure", handleOAuthFailureRedirect);

module.exports = router;
