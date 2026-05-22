const express = require("express");
const ensureDbConnection = require("../middleware/ensureDbConnection");
const {
  createListingInquiryConversation,
  listMyConversations,
  listConversationMessages,
  sendConversationMessage,
  markConversationAsRead,
  listAdminConversations
} = require("../controllers/messageController");

const router = express.Router();

router.use(ensureDbConnection);
router.post("/listings/:propertyId", createListingInquiryConversation);
router.get("/conversations", listMyConversations);
router.get("/conversations/:conversationId/messages", listConversationMessages);
router.post("/conversations/:conversationId/messages", sendConversationMessage);
router.post("/conversations/:conversationId/read", markConversationAsRead);
router.get("/admin/conversations", listAdminConversations);
router.get("/admin/conversations/:conversationId/messages", listConversationMessages);

module.exports = router;
