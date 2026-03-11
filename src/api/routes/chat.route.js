const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chat.controller");
const { verifyToken } = require("../middleware/authMiddleware");

router.get("/conversations", verifyToken, chatController.getConversations);

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
