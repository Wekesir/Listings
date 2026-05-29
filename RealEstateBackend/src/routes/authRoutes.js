const express = require("express");
const {
  registerUser,
  createAdminUser,
  createEmployeeUser,
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
  getAccessControlModules,
  getEmployeeRoles,
  createEmployeeRole,
  updateEmployeeRole,
  deleteEmployeeRole,
  getEmployeeRolePermissions,
  replaceEmployeeRolePermissions,
  assignEmployeeRole,
  getUserEffectiveAccess,
  replaceUserAccessOverrides,
  getListingPricingConfiguration,
  updateListingPricingConfiguration,
  getManageableUsers,
  suspendUserAccount,
  banUserAccount,
  clearUserRestrictions,
  getEmailDeliveryConfiguration,
  updateEmailDeliveryConfiguration,
  triggerSponsorshipExpiryRun
} = require("../controllers/authController");
const { passport } = require("../services/auth/passport");
const {
  getAdminListingReports,
  resolveListingReport
} = require("../controllers/listingReportController");
const ensureDbConnection = require("../middleware/ensureDbConnection");
const { requireModulePermission } = require("../middleware/requirePermission");
const { ACCESS_ACTIONS, MODULE_KEYS } = require("../utils/accessControl");

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
router.get("/audit-logs", requireModulePermission(MODULE_KEYS.AUDIT_LOGS, ACCESS_ACTIONS.VIEW), getAuthAuditLogs);
router.post("/audit-logs/delete", requireModulePermission(MODULE_KEYS.AUDIT_LOGS, ACCESS_ACTIONS.MANAGE), deleteAuthAuditLogs);
router.get("/access-control/modules", getAccessControlModules);
router.get("/employee-roles", getEmployeeRoles);
router.post("/employee-roles", createEmployeeRole);
router.put("/employee-roles/:roleId", updateEmployeeRole);
router.delete("/employee-roles/:roleId", deleteEmployeeRole);
router.get("/employee-roles/:roleId/permissions", getEmployeeRolePermissions);
router.put("/employee-roles/:roleId/permissions", replaceEmployeeRolePermissions);
router.get("/listing-pricing", requireModulePermission(MODULE_KEYS.PRICING, ACCESS_ACTIONS.VIEW), getListingPricingConfiguration);
router.put("/listing-pricing", requireModulePermission(MODULE_KEYS.PRICING, ACCESS_ACTIONS.MANAGE), updateListingPricingConfiguration);
router.get("/users", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.VIEW), getManageableUsers);
router.post("/users/employee", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE), createEmployeeUser);
router.put("/users/:userId/employee-role", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE), assignEmployeeRole);
router.get("/users/:userId/access", getUserEffectiveAccess);
router.put("/users/:userId/access", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE), replaceUserAccessOverrides);
router.get("/users/me/access", getUserEffectiveAccess);
router.get("/listing-reports", requireModulePermission(MODULE_KEYS.LISTING_REPORTS, ACCESS_ACTIONS.VIEW), getAdminListingReports);
router.patch("/listing-reports/:reportId", requireModulePermission(MODULE_KEYS.LISTING_REPORTS, ACCESS_ACTIONS.MANAGE), resolveListingReport);
router.post("/users/admin", createAdminUser);
router.post("/users/:userId/suspend", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE), suspendUserAccount);
router.post("/users/:userId/ban", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE), banUserAccount);
router.post("/users/:userId/clear-restrictions", requireModulePermission(MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE), clearUserRestrictions);
router.get("/email-delivery", requireModulePermission(MODULE_KEYS.SYSTEM_SETTINGS, ACCESS_ACTIONS.VIEW), getEmailDeliveryConfiguration);
router.put("/email-delivery", requireModulePermission(MODULE_KEYS.SYSTEM_SETTINGS, ACCESS_ACTIONS.MANAGE), updateEmailDeliveryConfiguration);
router.post("/debug/sponsorship-expiry/run", requireModulePermission(MODULE_KEYS.SYSTEM_SETTINGS, ACCESS_ACTIONS.MANAGE), triggerSponsorshipExpiryRun);
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
