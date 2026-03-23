const express = require("express");
const router = express.Router();

const storyReplyController = require("../controllers/story-reply.controller");
const { verifyToken } = require("../middleware/authMiddleware");

router.post("/:storyId/reply", verifyToken, storyReplyController.replyToStory);
router.get("/:storyId/replies", verifyToken, storyReplyController.getReplies);
router.delete("/reply/:replyId", verifyToken, storyReplyController.deleteReply);

module.exports = router;
