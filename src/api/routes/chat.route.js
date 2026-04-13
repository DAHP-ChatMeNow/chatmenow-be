const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chat.controller");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");
const { multerUploads } = require("../middleware/storage");

router.get("/conversations", verifyToken, chatController.getConversations);
router.get(
  "/ai/conversation",
  verifyToken,
  chatController.getOrCreateAiConversation,
);
router.post("/ai/message", verifyToken, chatController.sendMessageToAi);
router.get(
  "/ai/admin/config",
  verifyToken,
  requireAdmin,
  chatController.getAiAdminConfig,
);
router.patch(
  "/ai/admin/config",
  verifyToken,
  requireAdmin,
  multerUploads,
  chatController.updateAiAdminConfig,
);
router.get(
  "/ai/admin/stats",
  verifyToken,
  requireAdmin,
  chatController.getAiUsageStats,
);
router.get(
  "/ai/admin/avatar",
  verifyToken,
  requireAdmin,
  chatController.getAiAvatarViewUrl,
);

router.post(
  "/conversations",
  verifyToken,
  chatController.createGroupConversation,
);

router.get(
  "/conversations/:id",
  verifyToken,
  chatController.getConversationDetails,
);

router.get(
  "/private/:partnerId",
  verifyToken,
  chatController.getOrCreatePrivateConversation,
);

router.get(
  "/conversations/:conversationId/partner",
  verifyToken,
  chatController.getPrivateConversationPartner,
);

router.get(
  "/conversations/:conversationId/join-info",
  verifyToken,
  chatController.getGroupJoinInfo,
);

router.post(
  "/conversations/:conversationId/join",
  verifyToken,
  chatController.joinGroupByLink,
);

router.get(
  "/conversations/:conversationId/messages",
  verifyToken,
  chatController.getMessages,
);

router.get(
  "/conversations/:conversationId/pinned-messages",
  verifyToken,
  chatController.getPinnedMessages,
);

router.post(
  "/conversations/:conversationId/pinned-messages/:messageId",
  verifyToken,
  chatController.pinMessage,
);

router.delete(
  "/conversations/:conversationId/pinned-messages/:messageId",
  verifyToken,
  chatController.unpinMessage,
);

router.patch(
  "/conversations/:conversationId/read",
  verifyToken,
  chatController.markConversationAsRead,
);

router.post(
  "/conversations/:conversationId/unread-summary",
  verifyToken,
  chatController.getUnreadSummary,
);

router.get(
  "/conversations/:conversationId/unread-summary/candidates",
  verifyToken,
  chatController.getUnreadSummaryCandidates,
);

router.get(
  "/conversations/:conversationId/unread-summary/history",
  verifyToken,
  chatController.getUnreadSummaryHistory,
);

router.get(
  "/conversations/:conversationId/unread-summary/history/:summaryId/messages",
  verifyToken,
  chatController.getUnreadSummaryMessages,
);

router.post("/messages", verifyToken, chatController.sendMessage);
router.post(
  "/messages/:messageId/unsend",
  verifyToken,
  chatController.unsendMessage,
);
router.delete(
  "/messages/:messageId/me",
  verifyToken,
  chatController.deleteMessageForMe,
);
router.patch("/messages/:messageId", verifyToken, chatController.editMessage);

router.post(
  "/conversations/:conversationId/members",
  verifyToken,
  chatController.addMemberToGroup,
);

router.post(
  "/group-member-requests/:notificationId/approve",
  verifyToken,
  chatController.approveGroupMemberRequest,
);

router.delete(
  "/conversations/:conversationId/members/:memberId",
  verifyToken,
  chatController.removeMemberFromGroup,
);

router.post(
  "/conversations/:conversationId/leave",
  verifyToken,
  chatController.leaveGroup,
);

router.patch(
  "/conversations/:conversationId",
  verifyToken,
  chatController.updateGroupConversation,
);

router.post(
  "/conversations/:conversationId/transfer-admin",
  verifyToken,
  chatController.transferGroupAdmin,
);

router.delete(
  "/conversations/:conversationId",
  verifyToken,
  chatController.dissolveGroup,
);

module.exports = router;
