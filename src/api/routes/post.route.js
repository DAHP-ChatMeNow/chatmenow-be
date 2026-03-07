const express = require("express");
const router = express.Router();
const postController = require("../controllers/post.controller");
const { verifyToken } = require("../middleware/authMiddleware");
const { multerPostMedia } = require("../middleware/storage");

router.post("/", verifyToken, multerPostMedia, postController.createPost);

router.get("/feed", verifyToken, postController.getNewsFeed);

router.get("/me", verifyToken, postController.getMyPosts);

router.get("/:id", verifyToken, postController.getPostDetail);

router.put("/:id/like", verifyToken, postController.toggleLikePost);

router.delete("/:id/like", verifyToken, postController.unlikePost);

router.get("/:postId/comments", verifyToken, postController.getComments);

router.post("/:postId/comments", verifyToken, postController.addComment);

module.exports = router;
