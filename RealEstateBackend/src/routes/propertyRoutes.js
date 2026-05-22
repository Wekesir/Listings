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
  getShortlistedProperties,
  addPropertyToShortlist,
  removePropertyFromShortlist,
  softDeleteProperty,
  restoreSoftDeletedProperty
} = require("../controllers/propertyController");
const { submitListingReport } = require("../controllers/listingReportController");
const { propertyMediaUpload } = require("../middleware/propertyUpload");
const ensureDbConnection = require("../middleware/ensureDbConnection");

const router = express.Router();

router.get("/", getAllProperties);
router.get("/mine", getMyProperties);
router.get("/shortlist", getShortlistedProperties);
router.post("/", propertyMediaUpload, createProperty);
router.put("/:id", propertyMediaUpload, updateProperty);
router.get("/:id/payments/status", getListingPaymentStatus);
router.post("/:id/payments/checkout", createListingPaymentCheckout);
router.post("/:id/shortlist", addPropertyToShortlist);
router.delete("/:id/shortlist", removePropertyFromShortlist);
router.post("/:id/soft-delete", softDeleteProperty);
router.post("/:id/restore", restoreSoftDeletedProperty);
router.post("/:id/report", ensureDbConnection, submitListingReport);
router.get("/:id", getPropertyById);
router.post("/:id/inquiries", ensureDbConnection, submitPropertyInquiry);

module.exports = router;
