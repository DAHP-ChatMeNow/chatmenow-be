const userService = require("../service/user.service");
const premiumService = require("../service/premium.service");

const DEFAULT_VNPAY_FE_RETURN_URL =
  "http://localhost:3000/payment/vnpay-return";

const getVNPayFrontendReturnUrl = () => {
  const configuredUrl = String(process.env.VNPAY_FE_RETURN_URL || "").trim();
  return configuredUrl || DEFAULT_VNPAY_FE_RETURN_URL;
};

const buildVNPayRedirectUrl = ({ result, error } = {}) => {
  const targetUrl = getVNPayFrontendReturnUrl();
  let redirectUrl;

  try {
    redirectUrl = new URL(targetUrl);
  } catch (parseError) {
    redirectUrl = new URL(DEFAULT_VNPAY_FE_RETURN_URL);
  }

  const processingCode = String(result?.processing?.code || "UNKNOWN_ERROR");
  const isSuccess =
    processingCode === "SUCCESS" || processingCode === "ALREADY_CONFIRMED";

  redirectUrl.searchParams.set("status", isSuccess ? "success" : "failed");
  redirectUrl.searchParams.set("processingCode", processingCode);

  if (result?.payDate) {
    redirectUrl.searchParams.set("payDate", result.payDate);
  }

  const transactionId = String(
    result?.processing?.transaction?._id || "",
  ).trim();
  if (transactionId) {
    redirectUrl.searchParams.set("transactionId", transactionId);
  }

  const vnpResponseCode = String(result?.verify?.vnp_ResponseCode || "").trim();
  if (vnpResponseCode) {
    redirectUrl.searchParams.set("vnpResponseCode", vnpResponseCode);
  }

  const vnpTxnStatus = String(
    result?.verify?.vnp_TransactionStatus || "",
  ).trim();
  if (vnpTxnStatus) {
    redirectUrl.searchParams.set("vnpTransactionStatus", vnpTxnStatus);
  }

  if (error) {
    redirectUrl.searchParams.set("status", "failed");
    redirectUrl.searchParams.set(
      "processingCode",
      String(error.code || error.statusCode || "UNKNOWN_ERROR"),
    );
    redirectUrl.searchParams.set(
      "message",
      String(error.message || "Không thể xác thực kết quả thanh toán"),
    );
  }

  return redirectUrl.toString();
};

exports.searchUsers = async (req, res) => {
  try {
    const { q, query, city, hometown, school, saveHistory } = req.query;
    const keyword = (q ?? query ?? "").trim();

    const filters = {
      keyword,
      city: (city ?? hometown ?? "").trim(),
      school: (school ?? "").trim(),
    };

    const result = await userService.searchUsers(filters, req.user.userId);
    const shouldSaveHistory =
      String(saveHistory || "true").toLowerCase() !== "false";

    if (shouldSaveHistory) {
      await userService.saveSearchHistory(req.user.userId, filters);
    }

    res.status(200).json({
      success: true,
      users: result.users,
      total: result.total,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getInteractionHistory = async (req, res) => {
  try {
    const result = await userService.getInteractionHistory(req.user.userId, {
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const user = await userService.getUserProfile(
      req.params.userId,
      req.user.userId,
    );

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getSearchHistory = async (req, res) => {
  try {
    const result = await userService.getSearchHistory(req.user.userId, {
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.clearSearchHistory = async (req, res) => {
  try {
    await userService.clearSearchHistory(req.user.userId);

    res.status(200).json({
      success: true,
      message: "Đã xóa lịch sử tìm kiếm",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getBlockedUsers = async (req, res) => {
  try {
    const result = await userService.getBlockedUsers(req.user.userId);

    res.status(200).json({
      success: true,
      blockedUsers: result.blockedUsers,
      total: result.total,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getFriendProfile = async (req, res) => {
  try {
    const viewerId = req.user.userId;
    const targetUserId = req.params.userId;

    const user = await userService.getFriendProfile(viewerId, targetUserId);

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getProfileVisitHistory = async (req, res) => {
  try {
    const result = await userService.getProfileVisitHistory(req.user.userId, {
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.clearProfileVisitHistory = async (req, res) => {
  try {
    await userService.clearProfileVisitHistory(req.user.userId);

    res.status(200).json({
      success: true,
      message: "Đã xóa lịch sử đã truy cập",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const updatedUser = await userService.updateProfile(
      req.user.userId,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Cập nhật thông tin thành công",
      user: updatedUser,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.updateAvatar = async (req, res) => {
  try {
    const updatedUser = await userService.updateAvatar(
      req.user.userId,
      req.body.avatar,
    );

    // ✅ Emit socket event để notify friends về avatar mới
    const io = req.app.get("io");
    const friends = updatedUser.friends || [];

    friends.forEach((friendId) => {
      io.to(friendId.toString()).emit("friend_avatar_updated", {
        userId: req.user.userId,
        avatar: updatedUser.avatar,
        displayName: updatedUser.displayName,
      });
    });

    res.status(200).json({
      success: true,
      message: "Cập nhật avatar thành công",
      user: updatedUser,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.updateCoverImage = async (req, res) => {
  try {
    const updatedUser = await userService.updateCoverImage(
      req.user.userId,
      req.body.coverImage,
    );

    res.status(200).json({
      success: true,
      message: "Cập nhật ảnh bìa thành công",
      user: updatedUser,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.blockUser = async (req, res) => {
  try {
    const result = await userService.blockUser(
      req.user.userId,
      req.params.userId,
    );

    res.status(200).json({
      success: true,
      message: "Đã chặn người dùng",
      blockedUser: result.blockedUser,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    await userService.unblockUser(req.user.userId, req.params.userId);

    res.status(200).json({
      success: true,
      message: "Đã mở chặn người dùng",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getContacts = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await userService.getContacts(userId);

    res.status(200).json({
      success: true,
      friends: result.friends,
      total: result.total,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.sendFriendRequest = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const receiverId = req.params.userId || req.body.receiverId;

    const result = await userService.sendFriendRequest(senderId, receiverId);

    // ✅ Emit socket event real-time đến người nhận
    const io = req.app.get("io");
    io.to(receiverId.toString()).emit("friend_request_received", {
      requestId: result._id,
      sender: {
        _id: req.user.userId,
        displayName: req.user.displayName,
        avatar: req.user.avatar,
      },
      createdAt: result.createdAt,
    });

    res.status(201).json({
      success: true,
      message: "Đã gửi lời mời kết bạn",
      request: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// API tìm kiếm và gửi lời mời kết bạn thông qua email, SĐT hoặc tên
exports.searchAndAddFriend = async (req, res) => {
  try {
    const { searchQuery } = req.body;
    const senderId = req.user.userId;

    const result = await userService.searchAndAddFriend(senderId, searchQuery);

    if (result.multiple) {
      return res.status(200).json({
        success: true,
        message: "Tìm thấy nhiều kết quả",
        multiple: true,
        users: result.users,
        total: result.total,
      });
    }

    // ✅ Emit socket event real-time đến người nhận
    const io = req.app.get("io");
    io.to(result.user._id.toString()).emit("friend_request_received", {
      requestId: result.request._id,
      sender: {
        _id: req.user.userId,
        displayName: req.user.displayName,
        avatar: req.user.avatar,
      },
      createdAt: result.request.createdAt,
    });

    res.status(201).json({
      success: true,
      message: "Đã tìm thấy và gửi lời mời kết bạn thành công",
      user: result.user,
      request: result.request,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        user: error.user,
      });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.respondFriendRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { requestId } = req.params;
    const { status } = req.body;

    await userService.respondFriendRequest(userId, requestId, status);

    res.status(200).json({ message: `Đã ${status} lời mời` });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPendingRequests = async (req, res) => {
  try {
    const result = await userService.getPendingRequests(req.user.userId);

    res.status(200).json({
      success: true,
      requests: result.requests,
      total: result.total,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
exports.acceptFriendRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { requestId } = req.params;

    const result = await userService.acceptFriendRequest(userId, requestId);

    // ✅ Emit socket events real-time cho cả 2 users
    const io = req.app.get("io");

    // Thông báo cho người gửi lời mời
    io.to(result.senderId.toString()).emit("friend_request_accepted", {
      acceptedBy: {
        _id: userId,
        displayName: req.user.displayName,
        avatar: req.user.avatar,
      },
      requestId: requestId,
      conversationId: result.conversationId,
    });

    // Cập nhật danh sách bạn bè cho cả 2 users
    io.to(userId).emit("friend_list_updated", {
      newFriend: result.senderInfo,
    });

    io.to(result.senderId.toString()).emit("friend_list_updated", {
      newFriend: result.receiverInfo,
    });

    res.json({
      success: true,
      friend: result.senderInfo,
      conversationId: result.conversationId,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.rejectFriendRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { requestId } = req.params;

    const result = await userService.rejectFriendRequest(userId, requestId);

    const io = req.app.get("io");

    // ✅ Emit socket event đến người gửi lời mời
    io.to(result.senderId.toString()).emit("friend_request_rejected", {
      rejectedBy: {
        _id: userId,
        displayName: req.user.displayName,
      },
      requestId: requestId,
    });

    // ✅ Emit socket event đến chính người từ chối để xóa request khỏi danh sách
    io.to(userId.toString()).emit("friend_request_removed", {
      requestId: requestId,
    });

    res
      .status(200)
      .json({ success: true, message: "Đã từ chối lời mời kết bạn" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.removeFriend = async (req, res) => {
  try {
    const userId = req.user.userId;
    const friendId = req.params.userId;

    await userService.removeFriend(userId, friendId);

    // ✅ Emit socket event cho cả 2 users
    const io = req.app.get("io");

    io.to(userId).emit("friend_removed", {
      removedFriendId: friendId,
    });

    io.to(friendId).emit("friend_removed", {
      removedFriendId: userId,
    });

    res
      .status(200)
      .json({ success: true, message: "Đã xóa bạn bè và hội thoại riêng tư" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// Lấy avatar URL của user
exports.getUserAvatar = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await userService.getUserAvatar(userId);

    res.status(200).json({
      success: true,
      avatar: result.avatar,
      displayName: result.displayName,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

// Lấy thông tin email và số điện thoại từ accountId của user
exports.getUserEmail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await userService.getUserEmail(userId);

    res.status(200).json({
      success: true,
      email: result.email,
      phoneNumber: result.phoneNumber,
      displayName: result.displayName,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// Lấy email của user cụ thể theo userId
exports.getUserEmailById = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await userService.getUserEmailById(userId);

    res.status(200).json({
      success: true,
      _id: result._id,
      displayName: result.displayName,
      avatar: result.avatar,
      email: result.email,
      phoneNumber: result.phoneNumber,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const result = await userService.getAllUsers(req.query);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.updateAccountStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await userService.updateAccountStatus(userId, req.body);

    res.status(200).json({
      success: true,
      message:
        result.accountStatus === "active"
          ? "Đã mở khóa tài khoản"
          : result.accountStatus === "locked"
            ? "Đã khóa tài khoản"
            : "Đã đình chỉ tài khoản",
      account: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPremiumOverview = async (req, res) => {
  try {
    const overview = await premiumService.getPremiumOverview(req.user.userId);

    res.status(200).json({
      success: true,
      ...overview,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPremiumPlans = async (req, res) => {
  try {
    const plans = await premiumService.getPlans();

    res.status(200).json({
      success: true,
      ...plans,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPremiumPaymentTemplate = async (req, res) => {
  try {
    const result = await premiumService.getMockPaymentTemplate(
      req.user.userId,
      req.query.planCode,
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.createPremiumMockCheckout = async (req, res) => {
  try {
    const result = await premiumService.startMockCheckout(
      req.user.userId,
      req.body || {},
    );

    res.status(201).json({
      success: true,
      message: "Đã tạo giao dịch thanh toán mẫu",
      transaction: result.transaction,
      plan: result.plan,
      currency: result.currency,
      paymentTemplate: result.paymentTemplate,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.confirmPremiumMockCheckout = async (req, res) => {
  try {
    const result = await premiumService.confirmMockCheckout(
      req.user.userId,
      req.params.transactionId,
      req.body || {},
    );

    res.status(200).json({
      success: true,
      message:
        result.transaction.status === "success"
          ? "Thanh toán mẫu thành công, gói Premium đã được kích hoạt"
          : "Giao dịch mẫu đã được cập nhật",
      transaction: result.transaction,
      premiumExpiryDate: result.premiumExpiryDate,
      alreadyConfirmed: result.alreadyConfirmed,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPremiumHistory = async (req, res) => {
  try {
    const includePending =
      String(req.query.includePending || "false").toLowerCase() === "true";
    const result = await premiumService.getPremiumHistory(req.user.userId, {
      page: req.query.page,
      limit: req.query.limit,
      includePending,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"] || req.headers.forwarded;
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "127.0.0.1"
  );
}

exports.createPremiumVNPayCheckout = async (req, res) => {
  try {
    const result = await premiumService.startVNPayCheckout(req.user.userId, {
      ...(req.body || {}),
      ipAddr: getClientIp(req),
    });

    res.status(201).json({
      success: true,
      message: "Đã tạo URL thanh toán VNPay",
      paymentUrl: result.paymentUrl,
      transaction: result.transaction,
      plan: result.plan,
      currency: result.currency,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.handleVNPayReturn = async (req, res) => {
  try {
    const result = await premiumService.verifyVNPayReturn(req.query || {}, {
      rawQueryString: req.originalUrl,
    });
    return res.redirect(302, buildVNPayRedirectUrl({ result }));
  } catch (error) {
    return res.redirect(302, buildVNPayRedirectUrl({ error }));
  }
};

exports.handleVNPayIpn = async (req, res) => {
  try {
    const result = await premiumService.verifyVNPayIpn(req.query || {}, {
      rawQueryString: req.originalUrl,
    });
    return res.status(200).json(result.ipnResponse);
  } catch (error) {
    return res.status(200).json({ RspCode: "99", Message: "Unknown error" });
  }
};
