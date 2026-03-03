const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const { multerUploads } = require("../middleware/storage");
const {
  uploadImage,
  deleteAvatar,
  getPresignedUrl,
} = require("../controllers/upload.controller");

router.post("/avatar", authMiddleware, multerUploads, uploadImage);

router.delete("/avatar", authMiddleware, deleteAvatar);

router.get("/presign-get", authMiddleware, getPresignedUrl);

module.exports = router;
