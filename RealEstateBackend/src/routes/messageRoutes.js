const express = require("express");
const ensureDbConnection = require("../middleware/ensureDbConnection");
const {
  createListingInquiryConversation,
  listMyConversations,
  getMyUnreadMessageCount,
  listConversationMessages,
  sendConversationMessage,
  markConversationAsRead,
  listAdminConversations
} = require("../controllers/messageController");
const { requireModulePermission } = require("../middleware/requirePermission");
const { ACCESS_ACTIONS, MODULE_KEYS } = require("../utils/accessControl");

const router = express.Router();

router.use(ensureDbConnection);
router.post("/listings/:propertyId", createListingInquiryConversation);
router.get("/conversations", listMyConversations);
router.get("/conversations/unread-count", getMyUnreadMessageCount);
router.get("/conversations/:conversationId/messages", listConversationMessages);
router.post("/conversations/:conversationId/messages", sendConversationMessage);
router.post("/conversations/:conversationId/read", markConversationAsRead);
router.get("/admin/conversations", requireModulePermission(MODULE_KEYS.ADMIN_MESSAGES, ACCESS_ACTIONS.VIEW), listAdminConversations);
router.get("/admin/conversations/:conversationId/messages", requireModulePermission(MODULE_KEYS.ADMIN_MESSAGES, ACCESS_ACTIONS.VIEW), listConversationMessages);

module.exports = router;
