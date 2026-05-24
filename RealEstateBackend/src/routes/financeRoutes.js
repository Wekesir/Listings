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

const router = express.Router();

router.use(ensureDbConnection);

router.get("/lister/summary", getListerFinanceSummary);
router.get("/lister/payments", getListerFinancePayments);
router.get("/lister/payments.csv", exportListerFinanceCsv);

router.get("/admin/summary", getAdminFinanceSummary);
router.get("/admin/payments", getAdminFinancePayments);
router.get("/admin/payments.csv", exportAdminFinanceCsv);

router.get("/:paymentId/receipt.pdf", downloadPaymentReceiptPdf);

module.exports = router;
