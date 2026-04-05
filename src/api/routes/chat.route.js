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
  "/conversations/:conversationId/messages",
  verifyToken,
  chatController.getMessages,
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

router.delete(
  "/conversations/:conversationId/members/:memberId",
  verifyToken,
  chatController.removeMemberFromGroup,
);

router.delete(
  "/conversations/:conversationId",
  verifyToken,
  chatController.dissolveGroup,
);

module.exports = router;
