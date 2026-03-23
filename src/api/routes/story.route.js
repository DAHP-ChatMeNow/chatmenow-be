const express = require("express");
const router = express.Router();

const storyController = require("../controllers/story.controller");
const storyReplyController = require("../controllers/story-reply.controller");
const { verifyToken } = require("../middleware/authMiddleware");
const { multerStoryMedia } = require("../middleware/storage");

router.post("/", verifyToken, multerStoryMedia, storyController.createStory);
router.get("/feed", verifyToken, storyController.getStoryFeed);
router.get("/users/:userId", verifyToken, storyController.getStoriesByUser);
router.post("/:storyId/view", verifyToken, storyController.markStoryViewed);
router.post("/:storyId/react", verifyToken, storyController.addReaction);
router.get("/:storyId/reactions", verifyToken, storyController.getReactions);
router.post("/:storyId/reply", verifyToken, storyReplyController.replyToStory);
router.get("/:storyId/replies", verifyToken, storyReplyController.getReplies);
router.delete("/reply/:replyId", verifyToken, storyReplyController.deleteReply);
router.delete("/:storyId", verifyToken, storyController.deleteStory);

module.exports = router;
