const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");

// ====== SPECIFIC ROUTES FIRST (must be before dynamic routes) ======

// Admin: Lấy danh sách tất cả người dùng
router.get("/all", verifyToken, requireAdmin, userController.getAllUsers);

router.put(
  "/:userId/account-status",
  verifyToken,
  requireAdmin,
  userController.updateAccountStatus,
);

router.get("/search", verifyToken, userController.searchUsers);
router.get(
  "/activity-history",
  verifyToken,
  userController.getInteractionHistory,
);
router.get("/search-history", verifyToken, userController.getSearchHistory);
router.delete("/search-history", verifyToken, userController.clearSearchHistory);
router.get(
  "/profile-visit-history",
  verifyToken,
  userController.getProfileVisitHistory,
);
router.delete(
  "/profile-visit-history",
  verifyToken,
  userController.clearProfileVisitHistory,
);

// Lấy email và SĐT của user hiện tại
router.get("/me/email", verifyToken, userController.getUserEmail);

// Lấy danh sách người dùng đã chặn
router.get("/blocked", verifyToken, userController.getBlockedUsers);

// Chặn một người dùng
router.post("/:userId/block", verifyToken, userController.blockUser);

// Mở chặn một người dùng
router.delete("/blocked/:userId", verifyToken, userController.unblockUser);

// Lấy profile của user hiện tại
router.get("/profile", verifyToken, (req, res) => {
  // Redirect to getUserProfile with current user's ID
  req.params.userId = req.user.userId;
  return userController.getUserProfile(req, res);
});

// Lấy profile người khác (dùng cho màn hình chat bấm vào bạn bè)
router.get(
  "/friends/:userId/profile",
  verifyToken,
  userController.getFriendProfile,
);

router.put("/profile", verifyToken, userController.updateProfile);

router.put("/avatar", verifyToken, userController.updateAvatar);

router.put("/cover-image", verifyToken, userController.updateCoverImage);

// Friend management endpoints
router.get(
  "/friend-requests/pending",
  verifyToken,
  userController.getPendingRequests,
);

// Tìm kiếm và gửi lời mời kết bạn qua email/SĐT/tên
router.post("/search-and-add", verifyToken, userController.searchAndAddFriend);

// Legacy endpoints (keep for backward compatibility)
router.post("/friend-request", verifyToken, userController.sendFriendRequest);

router.put(
  "/friend-request/:requestId",
  verifyToken,
  userController.respondFriendRequest,
);

// ====== DYNAMIC ROUTES LAST (with :params) ======

router.get("/:userId/contacts", verifyToken, userController.getContacts);

// Lấy email của user cụ thể theo userId
router.get("/:userId/email", verifyToken, userController.getUserEmailById);

// Lấy avatar của user cụ thể theo userId
router.get("/:userId/avatar", verifyToken, userController.getUserAvatar);

// Lấy thông tin profile của user (displayName, avatar, bio, isOnline, friends)
router.get("/:userId", verifyToken, userController.getUserProfile);

router.post(
  "/friend-requests/:userId",
  verifyToken,
  userController.sendFriendRequest,
);

router.put(
  "/friend-requests/:requestId/accept",
  verifyToken,
  userController.acceptFriendRequest,
);

router.put(
  "/friend-requests/:requestId/reject",
  verifyToken,
  userController.rejectFriendRequest,
);

router.delete("/friends/:userId", verifyToken, userController.removeFriend);

module.exports = router;
