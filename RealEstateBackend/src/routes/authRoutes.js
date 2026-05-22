const express = require("express");
const {
  registerUser,
  createAdminUser,
  loginUser,
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
  clearUserRestrictions
} = require("../controllers/authController");
const {
  getAdminListingReports,
  resolveListingReport
} = require("../controllers/listingReportController");
const ensureDbConnection = require("../middleware/ensureDbConnection");

const router = express.Router();

router.use(ensureDbConnection);
router.post("/register", registerUser);
router.post("/login", loginUser);
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
router.put("/profile", updateProfile);

module.exports = router;
