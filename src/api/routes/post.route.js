const express = require("express");
const router = express.Router();
const postController = require("../controllers/post.controller");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");
const { multerPostMedia } = require("../middleware/storage");

router.post("/", verifyToken, multerPostMedia, postController.createPost);

router.get("/feed", verifyToken, postController.getNewsFeed);

router.get("/me", verifyToken, postController.getMyPosts);

router.get(
  "/admin/all",
  verifyToken,
  requireAdmin,
  postController.getAllPostsForAdmin,
);
router.get(
  "/admin/stats",
  verifyToken,
  requireAdmin,
  postController.getPostStatsForAdmin,
);
router.get(
  "/admin/:id/likes",
  verifyToken,
  requireAdmin,
  postController.getPostLikesForAdmin,
);
router.get(
  "/admin/:id/comments",
  verifyToken,
  requireAdmin,
  postController.getPostCommentsForAdmin,
);
router.get(
  "/admin/:id",
  verifyToken,
  requireAdmin,
  postController.getPostDetailForAdmin,
);
router.patch(
  "/admin/:id/privacy",
  verifyToken,
  requireAdmin,
  postController.updatePostPrivacyForAdmin,
);
router.delete(
  "/admin/:id",
  verifyToken,
  requireAdmin,
  postController.deletePostForAdmin,
);

router.get("/user/:userId", verifyToken, postController.getUserPosts);

router.post("/:id/share", verifyToken, postController.sharePostToMyTimeline);
router.post(
  "/:id/share-to-chat",
  verifyToken,
  postController.sharePostToConversation,
);

router.get("/:id", verifyToken, postController.getPostDetail);

router.patch("/:id/privacy", verifyToken, postController.updateMyPostPrivacy);

router.delete("/:id", verifyToken, postController.deleteMyPost);

router.put("/:id/like", verifyToken, postController.toggleLikePost);

router.delete("/:id/like", verifyToken, postController.unlikePost);

router.get("/:postId/comments", verifyToken, postController.getComments);

router.post("/:postId/comments", verifyToken, postController.addComment);

router.post("/:postId/ai-chat", verifyToken, postController.askAiAboutPost);

module.exports = router;
