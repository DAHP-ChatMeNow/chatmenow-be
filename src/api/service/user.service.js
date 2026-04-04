const User = require("../models/user.model");
const FriendRequest = require("../models/friend-request.model");
const Notification = require("../models/notification.model");
const Account = require("../models/account.model");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const { formatLastSeen } = require("../../utils/last-seen.helper");
const {
  emitNotificationToUser,
} = require("../../utils/realtime-notification.helper");
const {
  CONVERSATION_TYPES,
  FRIEND_REQUEST_STATUS,
} = require("../../constants");

class UserService {
  buildFriendRequestNotificationPayload(notification, sender, targetUrl) {
    return {
      ...notification.toObject(),
      senderName: sender?.displayName || null,
      senderAvatar: sender?.avatar || null,
      displayText: `${sender?.displayName || "Ai đó"} đã gửi cho bạn lời mời kết bạn.`,
      previewImage: sender?.avatar || null,
      targetUrl,
      isRead: false,
    };
  }

  buildCreatedAtFilter({ date, dateFrom, dateTo }) {
    const createdAtFilter = {};

    const safeDate = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const exactDate = safeDate(date) || safeDate(dateFrom) || safeDate(dateTo);
    if (exactDate) {
      const start = new Date(exactDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(exactDate);
      end.setHours(23, 59, 59, 999);

      createdAtFilter.$gte = start;
      createdAtFilter.$lte = end;
      return createdAtFilter;
    }

    return null;
  }

  async searchUsers(keyword, currentUserId) {
    if (!keyword) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập từ khóa tìm kiếm",
      };
    }

    // Tìm account theo email / phone
    const accountsByContact = await Account.find({
      $or: [
        { phoneNumber: { $regex: keyword, $options: "i" } },
        { email: { $regex: keyword, $options: "i" } },
      ],
    }).select("_id");

    const accountIds = accountsByContact.map((acc) => acc._id);

    const users = await User.find({
      $or: [
        { displayName: { $regex: keyword, $options: "i" } },
        { accountId: { $in: accountIds } },
      ],
      _id: { $ne: currentUserId },
    })
      .populate("accountId", "phoneNumber email")
      .select("displayName avatar bio accountId")
      .limit(20);

    const currentUser = await User.findById(currentUserId).select("friends");

    const usersWithFriendStatus = await Promise.all(
      users.map(async (user) => {
        const isFriend = currentUser.friends.includes(user._id);

        const pendingRequest = await FriendRequest.findOne({
          $or: [
            {
              sender: currentUserId,
              receiver: user._id,
              status: FRIEND_REQUEST_STATUS.PENDING,
            },
            {
              sender: user._id,
              receiver: currentUserId,
              status: FRIEND_REQUEST_STATUS.PENDING,
            },
          ],
        });

        return {
          _id: user._id,
          displayName: user.displayName,
          avatar: user.avatar,
          bio: user.bio,
          phoneNumber: user.accountId?.phoneNumber || "",
          email: user.accountId?.email || "",
          isFriend,
          hasPendingRequest: !!pendingRequest,
          requestSentByMe: pendingRequest?.sender?.toString() === currentUserId,
        };
      }),
    );

    return {
      users: usersWithFriendStatus,
      total: usersWithFriendStatus.length,
    };
  }

  async getUserProfile(userId) {
    // Validate ObjectId format
    if (!userId) {
      throw {
        statusCode: 400,
        message: "User ID không hợp lệ",
      };
    }

    const user = await User.findById(userId)
      .populate("friends", "displayName avatar")
      .select("-__v");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return {
      _id: user._id,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      lastSeenText: formatLastSeen(user.lastSeen, user.isOnline),
      coverImage: user.coverImage,
      friends: user.friends,
      createdAt: user.createdAt,
    };
  }

  async getFriendProfile(viewerId, targetUserId) {
    if (!targetUserId) {
      throw {
        statusCode: 400,
        message: "User ID không hợp lệ",
      };
    }

    const [viewer, targetUser] = await Promise.all([
      User.findById(viewerId).select("friends"),
      User.findById(targetUserId)
        .populate("friends", "_id")
        .select(
          "displayName avatar bio coverImage isOnline lastSeen friends createdAt",
        ),
    ]);

    if (!viewer) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng hiện tại",
      };
    }

    if (!targetUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const viewerFriendIds = new Set(
      (viewer.friends || []).map((id) => id.toString()),
    );
    const targetFriendIds = (targetUser.friends || []).map((friend) =>
      friend._id.toString(),
    );

    const isFriend = viewerFriendIds.has(targetUser._id.toString());
    const mutualFriendsCount = targetFriendIds.filter((friendId) =>
      viewerFriendIds.has(friendId),
    ).length;

    return {
      _id: targetUser._id,
      displayName: targetUser.displayName,
      avatar: targetUser.avatar,
      bio: targetUser.bio,
      coverImage: targetUser.coverImage,
      isOnline: targetUser.isOnline,
      lastSeen: targetUser.lastSeen,
      lastSeenText: formatLastSeen(targetUser.lastSeen, targetUser.isOnline),
      friendsCount: targetFriendIds.length,
      isFriend,
      mutualFriendsCount,
      createdAt: targetUser.createdAt,
    };
  }

  /**
   * Cập nhật profile
   */
  async updateProfile(userId, { displayName, bio, language, themeColor }) {
    if (displayName && displayName.trim().length < 2) {
      throw {
        statusCode: 400,
        message: "Tên hiển thị phải có ít nhất 2 ký tự",
      };
    }

    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (bio !== undefined) updateData.bio = bio;
    if (language !== undefined) updateData.language = language;
    if (themeColor !== undefined) updateData.themeColor = themeColor;

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select("-__v");

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return updatedUser;
  }

  async updateAvatar(userId, avatar) {
    if (!avatar) {
      throw {
        statusCode: 400,
        message: "Vui lòng cung cấp URL avatar",
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar },
      { new: true, runValidators: true },
    )
      .select("-__v")
      .populate("friends", "_id");

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return updatedUser;
  }

  /**
   * Lấy avatar URL của user
   */
  async getUserAvatar(userId) {
    if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
      throw {
        statusCode: 400,
        message: "User ID không hợp lệ",
      };
    }

    const user = await User.findById(userId).select("avatar displayName");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return {
      avatar: user.avatar || null,
      displayName: user.displayName,
    };
  }

  /**
   * Cập nhật ảnh bìa
   */
  async updateCoverImage(userId, coverImage) {
    if (!coverImage) {
      throw {
        statusCode: 400,
        message: "Vui lòng cung cấp URL ảnh bìa",
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { coverImage },
      { new: true, runValidators: true },
    ).select("-__v");

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return updatedUser;
  }

  /**
   * Lấy danh sách bạn bè
   */
  async getContacts(userId) {
    const user = await User.findById(userId).populate(
      "friends",
      "displayName avatar bio isOnline lastSeen",
    );

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return {
      friends: user.friends.map((friend) => ({
        _id: friend._id,
        displayName: friend.displayName,
        avatar: friend.avatar,
        bio: friend.bio,
        isOnline: friend.isOnline,
        lastSeen: friend.lastSeen,
        lastSeenText: formatLastSeen(friend.lastSeen, friend.isOnline),
      })),
      total: user.friends.length,
    };
  }

  /**
   * Gửi lời mời kết bạn
   */
  async sendFriendRequest(senderId, receiverId) {
    if (senderId === receiverId) {
      throw {
        statusCode: 400,
        message: "Không thể kết bạn với chính mình",
      };
    }

    // Kiểm tra người nhận có tồn tại không
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      throw {
        statusCode: 404,
        message: "Người dùng không tồn tại",
      };
    }

    // Kiểm tra đã là bạn bè chưa
    const sender = await User.findById(senderId);
    if (sender.friends.includes(receiverId)) {
      throw {
        statusCode: 400,
        message: "Đã là bạn bè rồi",
      };
    }

    // Kiểm tra lời mời đã tồn tại (bất kỳ status nào)
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    });

    if (existingRequest) {
      // Nếu người kia đã gửi lời mời cho mình (pending)
      if (
        existingRequest.senderId.toString() === receiverId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message: "Người này đã gửi lời mời kết bạn cho bạn",
        };
      }

      // Nếu mình đã gửi và đang pending
      if (
        existingRequest.senderId.toString() === senderId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message: "Đã gửi lời mời trước đó",
        };
      }

      // Nếu đã bị rejected hoặc expired, update lại thành pending
      if (existingRequest.senderId.toString() === senderId) {
        existingRequest.status = FRIEND_REQUEST_STATUS.PENDING;
        existingRequest.createdAt = new Date();
        await existingRequest.save();

        // Tạo thông báo
        const notification = await Notification.create({
          recipientId: receiverId,
          senderId: senderId,
          type: "friend_request",
          referenced: existingRequest._id,
          message: "đã gửi cho bạn lời mời kết bạn.",
        });

        emitNotificationToUser(
          receiverId,
          this.buildFriendRequestNotificationPayload(
            notification,
            sender,
            `/friends/requests/${existingRequest._id}`,
          ),
        );

        return existingRequest;
      }
    }

    // Tạo lời mời mới
    const newRequest = await FriendRequest.create({ senderId, receiverId });

    // Tạo thông báo
    const notification = await Notification.create({
      recipientId: receiverId,
      senderId: senderId,
      type: "friend_request",
      referenced: newRequest._id,
      message: "đã gửi cho bạn lời mời kết bạn.",
    });

    emitNotificationToUser(
      receiverId,
      this.buildFriendRequestNotificationPayload(
        notification,
        sender,
        `/friends/requests/${newRequest._id}`,
      ),
    );

    return newRequest;
  }

  /**
   * Tìm kiếm và gửi lời mời kết bạn
   */
  async searchAndAddFriend(senderId, searchQuery) {
    if (!searchQuery) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập email, số điện thoại hoặc tên người dùng",
      };
    }

    // Tìm kiếm theo email hoặc số điện thoại trong Account
    const accountsByContact = await Account.find({
      $or: [
        { email: searchQuery.toLowerCase().trim() },
        { phoneNumber: searchQuery.trim() },
      ],
    }).select("_id");

    const accountIds = accountsByContact.map((acc) => acc._id);

    // Tìm kiếm người dùng
    const users = await User.find({
      $or: [
        { displayName: { $regex: `^${searchQuery.trim()}$`, $options: "i" } },
        { accountId: { $in: accountIds } },
      ],
      _id: { $ne: senderId },
    })
      .populate("accountId", "phoneNumber email")
      .select("displayName avatar bio accountId");

    if (users.length === 0) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    // Nếu tìm thấy nhiều kết quả
    if (users.length > 1) {
      const usersWithStatus = await Promise.all(
        users.map(async (user) => {
          const sender = await User.findById(senderId);
          const isFriend = sender.friends.includes(user._id);

          const pendingRequest = await FriendRequest.findOne({
            $or: [
              {
                senderId,
                receiverId: user._id,
                status: FRIEND_REQUEST_STATUS.PENDING,
              },
              {
                senderId: user._id,
                receiverId: senderId,
                status: FRIEND_REQUEST_STATUS.PENDING,
              },
            ],
          });

          return {
            _id: user._id,
            displayName: user.displayName,
            avatar: user.avatar,
            bio: user.bio,
            phoneNumber: user.accountId?.phoneNumber || "",
            email: user.accountId?.email || "",
            isFriend,
            hasPendingRequest: !!pendingRequest,
          };
        }),
      );

      return {
        multiple: true,
        users: usersWithStatus,
        total: usersWithStatus.length,
      };
    }

    // Chỉ có 1 kết quả - tự động gửi lời mời
    const receiverId = users[0]._id;

    // Kiểm tra đã là bạn bè chưa
    const sender = await User.findById(senderId);
    if (sender.friends.includes(receiverId)) {
      throw {
        statusCode: 400,
        message: "Đã là bạn bè rồi",
        user: {
          _id: users[0]._id,
          displayName: users[0].displayName,
          avatar: users[0].avatar,
        },
      };
    }

    // Kiểm tra lời mời đã tồn tại
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    });

    if (existingRequest) {
      // Nếu người kia đã gửi lời mời cho mình (pending)
      if (
        existingRequest.senderId.toString() === receiverId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message:
            "Người này đã gửi lời mời kết bạn cho bạn. Vui lòng kiểm tra lời mời kết bạn",
          user: {
            _id: users[0]._id,
            displayName: users[0].displayName,
            avatar: users[0].avatar,
          },
        };
      }

      // Nếu mình đã gửi và đang pending
      if (
        existingRequest.senderId.toString() === senderId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message: "Đã gửi lời mời cho người này trước đó",
          user: {
            _id: users[0]._id,
            displayName: users[0].displayName,
            avatar: users[0].avatar,
          },
        };
      }

      // Nếu đã bị rejected, update lại thành pending
      if (existingRequest.senderId.toString() === senderId) {
        existingRequest.status = FRIEND_REQUEST_STATUS.PENDING;
        existingRequest.createdAt = new Date();
        await existingRequest.save();

        // Tạo thông báo
        const notification = await Notification.create({
          recipientId: receiverId,
          senderId: senderId,
          type: "friend_request",
          referenced: existingRequest._id,
          message: "đã gửi cho bạn lời mời kết bạn.",
        });

        emitNotificationToUser(
          receiverId,
          this.buildFriendRequestNotificationPayload(
            notification,
            sender,
            `/friends/requests/${existingRequest._id}`,
          ),
        );

        return {
          multiple: false,
          user: {
            _id: users[0]._id,
            displayName: users[0].displayName,
            avatar: users[0].avatar,
            phoneNumber: users[0].accountId?.phoneNumber || "",
            email: users[0].accountId?.email || "",
          },
          request: existingRequest,
        };
      }
    }

    // Tạo lời mời mới
    const newRequest = await FriendRequest.create({ senderId, receiverId });

    // Tạo thông báo
    const notification = await Notification.create({
      recipientId: receiverId,
      senderId: senderId,
      type: "friend_request",
      referenced: newRequest._id,
      message: "đã gửi cho bạn lời mời kết bạn.",
    });

    emitNotificationToUser(
      receiverId,
      this.buildFriendRequestNotificationPayload(
        notification,
        sender,
        `/friends/requests/${newRequest._id}`,
      ),
    );

    return {
      multiple: false,
      user: {
        _id: users[0]._id,
        displayName: users[0].displayName,
        avatar: users[0].avatar,
        phoneNumber: users[0].accountId?.phoneNumber || "",
        email: users[0].accountId?.email || "",
      },
      request: newRequest,
    };
  }

  /**
   * Chấp nhận/từ chối lời mời kết bạn
   */
  async respondFriendRequest(userId, requestId, status) {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw {
        statusCode: 404,
        message: "Lời mời không tồn tại",
      };
    }

    if (request.receiverId.toString() !== userId) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xử lý lời mời này",
      };
    }

    request.status = status;
    await request.save();

    if (status === FRIEND_REQUEST_STATUS.ACCEPTED) {
      const senderId = request.senderId;

      // Kiểm tra conversation đã tồn tại chưa
      const existingConv = await Conversation.findOne({
        type: CONVERSATION_TYPES.PRIVATE,
        "members.userId": { $all: [userId, senderId] },
      });

      // Tạo conversation nếu chưa có
      const conversationPromise = existingConv
        ? Promise.resolve(existingConv)
        : (async () => {
            const senderUser =
              await User.findById(senderId).select("displayName avatar");
            return Conversation.create({
              type: CONVERSATION_TYPES.PRIVATE,
              name: senderUser.displayName,
              groupAvatar: senderUser.avatar,
              members: [
                { userId, role: "member" },
                { userId: senderId, role: "member" },
              ],
            });
          })();

      await Promise.all([
        User.findByIdAndUpdate(userId, { $addToSet: { friends: senderId } }),
        User.findByIdAndUpdate(senderId, { $addToSet: { friends: userId } }),
        Notification.create({
          recipientId: senderId,
          senderId: userId,
          type: "system",
          message: "đã chấp nhận lời mời kết bạn.",
        }),
        conversationPromise,
      ]);

      const senderUser =
        await User.findById(userId).select("displayName avatar");
      emitNotificationToUser(senderId, {
        type: "system",
        senderId: userId,
        senderName: senderUser?.displayName || null,
        senderAvatar: senderUser?.avatar || null,
        displayText: `${senderUser?.displayName || "Ai đó"} đã chấp nhận lời mời kết bạn.`,
        previewImage: senderUser?.avatar || null,
        targetUrl: `/users/${userId}`,
        isRead: false,
      });
    }

    return { status };
  }

  /**
   * Lấy danh sách lời mời kết bạn pending
   */
  async getPendingRequests(userId) {
    const requests = await FriendRequest.find({
      receiverId: userId,
      status: FRIEND_REQUEST_STATUS.PENDING,
    }).populate("senderId", "displayName avatar");

    return {
      requests: requests,
      total: requests.length,
    };
  }

  /**
   * Chấp nhận lời mời kết bạn
   */
  async acceptFriendRequest(userId, requestId) {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw {
        statusCode: 404,
        message: "Lời mời không tồn tại",
      };
    }

    if (request.receiverId.toString() !== userId) {
      throw {
        statusCode: 403,
        message: "Không có quyền xử lý",
      };
    }

    if (request.status === FRIEND_REQUEST_STATUS.ACCEPTED) {
      throw {
        statusCode: 400,
        message: "Lời mời đã được chấp nhận",
      };
    }

    request.status = FRIEND_REQUEST_STATUS.ACCEPTED;
    await request.save();

    const senderId = request.senderId;

    // Lấy thông tin của cả 2 users
    const [sender, receiver] = await Promise.all([
      User.findById(senderId).select("displayName avatar bio isOnline"),
      User.findById(userId).select("displayName avatar bio isOnline"),
      User.findByIdAndUpdate(userId, { $addToSet: { friends: senderId } }),
      User.findByIdAndUpdate(senderId, { $addToSet: { friends: userId } }),
      Notification.create({
        recipientId: senderId,
        senderId: userId,
        type: "system",
        message: "đã chấp nhận lời mời kết bạn.",
      }),
    ]);

    const receiverUser =
      await User.findById(userId).select("displayName avatar");
    emitNotificationToUser(senderId, {
      type: "system",
      senderId: userId,
      senderName: receiverUser?.displayName || null,
      senderAvatar: receiverUser?.avatar || null,
      displayText: `${receiverUser?.displayName || "Ai đó"} đã chấp nhận lời mời kết bạn.`,
      previewImage: receiverUser?.avatar || null,
      targetUrl: `/users/${userId}`,
      isRead: false,
    });

    return {
      success: true,
      senderId: senderId,
      senderInfo: sender,
      receiverInfo: receiver,
    };
  }

  /**
   * Từ chối lời mời kết bạn
   */
  async rejectFriendRequest(userId, requestId) {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw {
        statusCode: 404,
        message: "Lời mời không tồn tại",
      };
    }

    if (request.receiverId.toString() !== userId) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xử lý lời mời này",
      };
    }

    const senderId = request.senderId;
    request.status = FRIEND_REQUEST_STATUS.REJECTED;
    await request.save();

    return { success: true, senderId: senderId };
  }

  /**
   * Xóa bạn bè
   */
  async removeFriend(userId, friendId) {
    if (userId === friendId) {
      throw {
        statusCode: 400,
        message: "Không thể xóa chính mình",
      };
    }

    // Xóa quan hệ bạn bè
    await Promise.all([
      User.findByIdAndUpdate(userId, { $pull: { friends: friendId } }),
      User.findByIdAndUpdate(friendId, { $pull: { friends: userId } }),
      FriendRequest.deleteMany({
        $or: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId },
        ],
      }),
    ]);

    // Tìm và xóa cuộc trò chuyện riêng tư
    const privateConversations = await Conversation.find({
      type: CONVERSATION_TYPES.PRIVATE,
      "members.userId": { $all: [userId, friendId] },
    }).select("_id");

    if (privateConversations.length > 0) {
      const convIds = privateConversations.map((c) => c._id);
      await Promise.all([
        Message.deleteMany({ conversationId: { $in: convIds } }),
        Conversation.deleteMany({ _id: { $in: convIds } }),
      ]);
    }

    return { success: true };
  }

  /**
   * Lấy email và số điện thoại của user hiện tại
   */
  async getUserEmail(userId) {
    const user = await User.findById(userId)
      .populate("accountId", "email phoneNumber")
      .select("accountId displayName");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    if (!user.accountId) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy thông tin tài khoản",
      };
    }

    return {
      email: user.accountId.email || "",
      phoneNumber: user.accountId.phoneNumber || "",
      displayName: user.displayName,
    };
  }

  /**
   * Lấy email của user theo ID
   */
  async getUserEmailById(userId) {
    const user = await User.findById(userId)
      .populate("accountId", "email phoneNumber")
      .select("accountId displayName avatar");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    if (!user.accountId) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy thông tin tài khoản",
      };
    }

    return {
      _id: user._id,
      displayName: user.displayName,
      avatar: user.avatar,
      email: user.accountId.email || "",
      phoneNumber: user.accountId.phoneNumber || "",
    };
  }

  /**
   * Lấy danh sách tất cả người dùng (chỉ admin)
   * Hỗ trợ filter + sort + offset/limit.
   */
  async getAllUsers({
    offset,
    limit = 20,
    page,
    search = "",
    role = "all",
    status = "all",
    sortBy = "newest",
    date,
    dateFrom,
    dateTo,
  }) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    // Backward compatibility: nếu không truyền offset thì dùng page/limit như cũ.
    let offsetNum;
    if (offset !== undefined) {
      offsetNum = Math.max(0, parseInt(offset, 10) || 0);
    } else {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      offsetNum = (pageNum - 1) * limitNum;
    }

    const userFilter = {};
    const accountFilter = {};
    if (role && role !== "all") {
      accountFilter.role = role;
    }

    // status UI: all | active | inactive | premium
    if (status && status !== "all") {
      if (status === "active") {
        accountFilter.accountStatus = "active";
      } else if (status === "inactive") {
        accountFilter.accountStatus = { $in: ["suspended", "locked"] };
      } else if (status === "premium") {
        accountFilter.isPremium = true;
      }
    }

    const hasAccountConstraint = Object.keys(accountFilter).length > 0;
    if (hasAccountConstraint) {
      const constrainedAccounts =
        await Account.find(accountFilter).select("_id");
      const constrainedAccountIds = constrainedAccounts.map((acc) => acc._id);
      userFilter.accountId = { $in: constrainedAccountIds };
    }

    if (search && search.trim()) {
      const keyword = search.trim();
      const accountSearchFilter = {
        ...accountFilter,
        $or: [
          { email: { $regex: keyword, $options: "i" } },
          { phoneNumber: { $regex: keyword, $options: "i" } },
        ],
      };

      const matchedAccountsByContact =
        await Account.find(accountSearchFilter).select("_id");

      const matchedAccountIdsByContact = matchedAccountsByContact.map(
        (acc) => acc._id,
      );

      userFilter.$or = [
        { displayName: { $regex: keyword, $options: "i" } },
        { accountId: { $in: matchedAccountIdsByContact } },
      ];
    }

    const createdAtFilter = this.buildCreatedAtFilter({
      date,
      dateFrom,
      dateTo,
    });

    if (createdAtFilter) {
      userFilter.createdAt = createdAtFilter;
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name_asc: { displayName: 1 },
      name_desc: { displayName: -1 },
      online_first: { isOnline: -1, lastSeen: -1 },
    };

    const finalSort = sortMap[sortBy] || sortMap.newest;

    const [users, total] = await Promise.all([
      User.find(userFilter)
        .populate(
          "accountId",
          "email phoneNumber role isPremium premiumExpiryDate isActive accountStatus suspendedUntil statusReason createdAt",
        )
        .select("displayName avatar bio isOnline lastSeen createdAt")
        .sort(finalSort)
        .skip(offsetNum)
        .limit(limitNum),
      User.countDocuments(userFilter),
    ]);

    const pageCurrent = Math.floor(offsetNum / limitNum) + 1;
    const totalPages = Math.ceil(total / limitNum);

    return {
      users: users.map((user) => ({
        _id: user._id,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        lastSeenText: formatLastSeen(user.lastSeen, user.isOnline),
        email: user.accountId?.email || "",
        phoneNumber: user.accountId?.phoneNumber || "",
        role: user.accountId?.role || "user",
        isPremium: user.accountId?.isPremium || false,
        isActive: user.accountId?.accountStatus === "active",
        accountStatus: user.accountId?.accountStatus || "active",
        suspendedUntil: user.accountId?.suspendedUntil || null,
        statusReason: user.accountId?.statusReason || "",
        createdAt: user.createdAt,
      })),
      total,
      offset: offsetNum,
      limit: limitNum,
      page: pageCurrent,
      totalPages,
      hasNext: offsetNum + limitNum < total,
      hasPrev: offsetNum > 0,
      filters: {
        search: search || "",
        role,
        status,
        sortBy,
        date: date || "",
        dateFrom: dateFrom || "",
        dateTo: dateTo || "",
      },
    };
  }

  async updateAccountStatus(
    userId,
    { accountStatus, suspendedUntil, statusReason },
  ) {
    const user = await User.findById(userId).select(
      "accountId displayName avatar",
    );

    if (!user) {
      throw {
        statusCode: 404,
        message: "Người dùng không tồn tại",
      };
    }

    const account = await Account.findById(user.accountId);

    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại",
      };
    }

    if (!["active", "suspended", "locked"].includes(accountStatus)) {
      throw {
        statusCode: 400,
        message: "Trạng thái tài khoản không hợp lệ",
      };
    }

    const updateData = {
      accountStatus,
      isActive: accountStatus === "active",
      statusReason: statusReason || "",
      statusUpdatedAt: new Date(),
    };

    if (accountStatus === "suspended") {
      const parsedUntil = suspendedUntil ? new Date(suspendedUntil) : null;
      if (!parsedUntil || Number.isNaN(parsedUntil.getTime())) {
        throw {
          statusCode: 400,
          message:
            "Vui lòng cung cấp suspendedUntil hợp lệ cho trạng thái đình chỉ",
        };
      }

      updateData.suspendedUntil = parsedUntil;
    } else {
      updateData.suspendedUntil = null;
    }

    await Account.findByIdAndUpdate(account._id, updateData, {
      new: true,
      runValidators: true,
    });

    return {
      _id: user._id,
      email: account.email,
      role: account.role,
      accountStatus: accountStatus,
      suspendedUntil: updateData.suspendedUntil,
      statusReason: updateData.statusReason,
      isActive: updateData.isActive,
      displayName: user.displayName,
      avatar: user.avatar,
    };
  }
}

module.exports = new UserService();
