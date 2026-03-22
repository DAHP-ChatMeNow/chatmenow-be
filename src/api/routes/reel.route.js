const express = require("express");
const multer  = require("multer");
const router  = express.Router();

const reelController = require("../controllers/reel.controller");
const { verifyToken } = require("../middleware/authMiddleware");

// Multer – single video file (stored in memory for S3 upload)
const multerReelVideo = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "video/webm",
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận file video (MP4, MPEG, MOV, AVI, WEBM)"));
    }
    cb(null, true);
  },
}).single("video"); // field name: "video"

// ─── Routes ──────────────────────────────────────────────────────────────────

// IMPORTANT: /feed and /user/:userId must come BEFORE /:id to avoid conflicts

// GET  /reels/feed?cursor=<base64>
router.get("/feed", verifyToken, reelController.getReelFeed);

// GET  /reels/user/:userId
router.get("/user/:userId", verifyToken, reelController.getUserReels);

// POST /reels  (multipart/form-data with field "video")
router.post("/", verifyToken, multerReelVideo, reelController.createReel);

// DELETE /reels/:id
router.delete("/:id", verifyToken, reelController.deleteReel);

// POST /reels/:id/like
router.post("/:id/like", verifyToken, reelController.likeReel);

// DELETE /reels/:id/like
router.delete("/:id/like", verifyToken, reelController.unlikeReel);

// POST /reels/:id/view
router.post("/:id/view", verifyToken, reelController.addView);

module.exports = router;
