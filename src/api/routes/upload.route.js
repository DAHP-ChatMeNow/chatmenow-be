const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const { multerUploads } = require("../middleware/storage");
const {
  uploadImage,
  deleteAvatar,
  getPresignedUrl,
  getChatAttachmentUploadUrl,
  uploadCoverImage,
  deleteCoverImage,
  getReelVideoUploadUrl,
} = require("../controllers/upload.controller");

router.post("/avatar", authMiddleware, multerUploads, uploadImage);

router.delete("/avatar", authMiddleware, deleteAvatar);

router.post("/cover-image", authMiddleware, multerUploads, uploadCoverImage);
router.delete("/cover-image", authMiddleware, deleteCoverImage);

router.get("/presign-get", authMiddleware, getPresignedUrl);
router.post("/chat/presign-put", authMiddleware, getChatAttachmentUploadUrl);
router.post("/reel-video/presign-put", authMiddleware, getReelVideoUploadUrl);

module.exports = router;
