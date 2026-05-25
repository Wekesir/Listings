const express = require("express");
const {
  getAllProperties,
  getMyProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  getListingPaymentStatus,
  createListingPaymentCheckout,
  submitPropertyInquiry,
  getMyPropertyAlertPreference,
  upsertMyPropertyAlertPreference,
  getShortlistedProperties,
  getMyListingEngagement,
  addPropertyToShortlist,
  removePropertyFromShortlist,
  softDeleteProperty,
  restoreSoftDeletedProperty
} = require("../controllers/propertyController");
const { submitListingReport } = require("../controllers/listingReportController");
const { propertyMediaUpload } = require("../middleware/propertyUpload");
const ensureDbConnection = require("../middleware/ensureDbConnection");
const { requireModulePermission } = require("../middleware/requirePermission");
const { ACCESS_ACTIONS, MODULE_KEYS } = require("../utils/accessControl");

const router = express.Router();

router.get("/", getAllProperties);
router.get("/mine", getMyProperties);
router.get("/mine/engagement", ensureDbConnection, getMyListingEngagement);
router.get("/shortlist", getShortlistedProperties);
router.get("/alerts/preference", getMyPropertyAlertPreference);
router.put("/alerts/preference", upsertMyPropertyAlertPreference);
router.post("/", propertyMediaUpload, createProperty);
router.put("/:id", propertyMediaUpload, updateProperty);
router.get("/:id/payments/status", getListingPaymentStatus);
router.post("/:id/payments/checkout", createListingPaymentCheckout);
router.post("/:id/shortlist", addPropertyToShortlist);
router.delete("/:id/shortlist", removePropertyFromShortlist);
router.post("/:id/soft-delete", requireModulePermission(MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.MANAGE), softDeleteProperty);
router.post("/:id/restore", requireModulePermission(MODULE_KEYS.PROPERTY_MODERATION, ACCESS_ACTIONS.MANAGE), restoreSoftDeletedProperty);
router.post("/:id/report", ensureDbConnection, submitListingReport);
router.get("/:id", getPropertyById);
router.post("/:id/inquiries", ensureDbConnection, submitPropertyInquiry);

module.exports = router;
