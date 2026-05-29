const express = require("express");
const {
  getListerFinanceSummary,
  getListerFinancePayments,
  getAdminFinanceSummary,
  getAdminFinancePayments,
  downloadPaymentReceiptPdf,
  exportListerFinanceCsv,
  exportAdminFinanceCsv
} = require("../controllers/financeController");
const ensureDbConnection = require("../middleware/ensureDbConnection");
const { requireModulePermission } = require("../middleware/requirePermission");
const { ACCESS_ACTIONS, MODULE_KEYS } = require("../utils/accessControl");

const router = express.Router();

router.use(ensureDbConnection);

router.get("/lister/summary", getListerFinanceSummary);
router.get("/lister/payments", getListerFinancePayments);
router.get("/lister/payments.csv", exportListerFinanceCsv);

router.get("/admin/summary", requireModulePermission(MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.VIEW), getAdminFinanceSummary);
router.get("/admin/payments", requireModulePermission(MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.VIEW), getAdminFinancePayments);
router.get("/admin/payments.csv", requireModulePermission(MODULE_KEYS.ADMIN_FINANCES, ACCESS_ACTIONS.MANAGE), exportAdminFinanceCsv);

router.get("/:paymentId/receipt.pdf", downloadPaymentReceiptPdf);

module.exports = router;
