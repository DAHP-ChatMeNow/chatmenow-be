const adminService = require("../service/admin.service");
const userService = require("../service/user.service");

exports.getStats = async (req, res) => {
  try {
    const stats = await adminService.getAdminStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};

exports.removeUserFriend = async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    await userService.removeFriend(userId, friendId);

    // Xóa bạn bè từ phía admin (removeFriend trong user.service đã tự handle việc xoá cả 2 chiều và xóa hội thoại/socket)
    const io = req.app.get("io");
    if (io) {
      io.to(userId).emit("friend_removed", { removedFriendId: friendId });
      io.to(friendId).emit("friend_removed", { removedFriendId: userId });
    }

    res.status(200).json({
      success: true,
      message: "Đã xóa bạn bè thành công",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
