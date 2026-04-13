const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin.controller");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");

router.get("/stats", verifyToken, requireAdmin, adminController.getStats);

// Quản lý bạn bè của người dùng (Admin)
router.delete("/users/:userId/friends/:friendId", verifyToken, requireAdmin, adminController.removeUserFriend);

module.exports = router;
