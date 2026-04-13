const express = require("express");
const router = express.Router();

const reelController = require("../controllers/reel.controller");
const { verifyToken } = require("../middleware/authMiddleware");

// Feed & my reels
router.get("/feed", verifyToken, reelController.getReelFeed);
router.get("/me", verifyToken, reelController.getMyReels);

// Create reel (client uploads video via presigned URL, then posts the S3 key)
router.post("/", verifyToken, reelController.createReel);

// Single reel
router.get("/:id", verifyToken, reelController.getReelById);
router.delete("/:id", verifyToken, reelController.deleteReel);

// Interactions
router.post("/:id/like", verifyToken, reelController.toggleLike);
router.post("/:id/view", verifyToken, reelController.incrementView);

// Comments
router.post("/:id/comments", verifyToken, reelController.addComment);
router.get("/:id/comments", verifyToken, reelController.getComments);

module.exports = router;
