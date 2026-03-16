const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const {
  CONVERSATION_TYPES,
  MESSAGE_TYPES,
  MEMBER_ROLES,
} = require("../../constants");
const { formatLastSeen } = require("../../utils/last-seen.helper");

class ChatService {
  /**
   * Lấy danh sách cuộc trò chuyện
   */
  async getConversations(userId) {
    const conversations = await Conversation.find({
      "members.userId": userId,
    })
      .sort({ updatedAt: -1 })
      .populate("members.userId", "displayName avatar isOnline lastSeen")
      .populate("lastMessage.senderId", "displayName avatar");

    return conversations;
  }

  /**
   * Lấy tin nhắn trong conversation
   */
  async getMessages(conversationId, { limit = 20, beforeId }) {
    const parsedLimit = parseInt(limit, 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    const query = { conversationId };

    if (beforeId) {
      const referenceMsg =
        await Message.findById(beforeId).select("_id createdAt");
      if (referenceMsg) {
        query.$or = [
          { createdAt: { $lt: referenceMsg.createdAt } },
          {
            createdAt: referenceMsg.createdAt,
            _id: { $lt: referenceMsg._id },
          },
        ];
      }
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(safeLimit + 1)
      .populate("senderId", "displayName avatar");

    const hasMore = messages.length > safeLimit;
    const pagedMessages = hasMore ? messages.slice(0, safeLimit) : messages;
    const ordered = pagedMessages.reverse();
    const nextCursor = hasMore && ordered.length ? ordered[0]._id : null;

    return {
      messages: ordered,
      total: ordered.length,
      limit: safeLimit,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Gửi tin nhắn
   */
  async sendMessage(senderId, { conversationId, content, type = "text" }) {
    const message = await Message.create({
      conversationId,
      senderId,
      content,
      type,
    });

    await message.populate("senderId", "displayName avatar");

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: {
        content: type === "image" ? "Đã gửi một ảnh" : content,
        senderId,
        senderName: message.senderId.displayName,
        type,
        createdAt: message.createdAt,
      },
      updatedAt: new Date(),
    });

    return message;
  }

  /**
   * Tạo nhóm chat
   */
  async createGroupConversation(userId, { name, memberIds, groupAvatar }) {
    if (!name || memberIds.length < 2) {
      throw {
        statusCode: 400,
        message: "Group phải có ít nhất 3 người",
      };
    }

    const members = [
      { userId, role: MEMBER_ROLES.ADMIN },
      ...memberIds.map((id) => ({ userId: id })),
    ];

    const group = await Conversation.create({
      type: CONVERSATION_TYPES.GROUP,
      name,
      groupAvatar,
      members,
    });

    return group;
  }

  /**
   * Lấy chi tiết conversation
   */
  async getConversationDetails(conversationId) {
    const conv = await Conversation.findById(conversationId).populate(
      "members.userId",
      "displayName avatar isOnline",
    );

    if (!conv) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy cuộc trò chuyện",
      };
    }

    return conv;
  }

  /**
   * Lấy hoặc tạo conversation riêng tư
   */
  async getOrCreatePrivateConversation(userId, partnerId) {
    let conversation = await Conversation.findOne({
      type: CONVERSATION_TYPES.PRIVATE,
      $and: [
        { members: { $elemMatch: { userId } } },
        { members: { $elemMatch: { userId: partnerId } } },
      ],
    }).select("_id type members lastMessage updatedAt");

    if (!conversation) {
      conversation = await Conversation.create({
        type: CONVERSATION_TYPES.PRIVATE,
        members: [{ userId }, { userId: partnerId }],
      });
    }

    return {
      conversation,
      isNew: !conversation._id,
    };
  }

  /**
   * Lấy thông tin đối tác trong conversation riêng tư
   */
  async getPrivateConversationPartner(userId, conversationId) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy cuộc trò chuyện",
      };
    }

    if (conversation.type !== CONVERSATION_TYPES.PRIVATE) {
      throw {
        statusCode: 400,
        message: "Chỉ áp dụng cho cuộc trò chuyện riêng tư",
      };
    }

    // Tìm partner
    const partnerMember = conversation.members.find(
      (member) => member.userId.toString() !== userId,
    );

    if (!partnerMember) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy đối tác",
      };
    }

    // Lấy thông tin partner
    const partner = await User.findById(partnerMember.userId).select(
      "displayName avatar isOnline lastSeen",
    );

    if (!partner) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy thông tin người dùng",
      };
    }

    return {
      _id: partner._id,
      displayName: partner.displayName,
      avatar: partner.avatar,
      isOnline: partner.isOnline,
      lastSeen: partner.lastSeen,
      lastSeenText: formatLastSeen(partner.lastSeen, partner.isOnline),
    };
  }

  /**
   * Thêm thành viên vào nhóm
   */
  async addMemberToGroup(userId, conversationId, memberIds) {
    // Kiểm tra nhóm tồn tại
    const group = await Conversation.findById(conversationId);
    if (!group) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy nhóm",
      };
    }

    if (group.type !== CONVERSATION_TYPES.GROUP) {
      throw {
        statusCode: 400,
        message: "Chỉ áp dụng cho nhóm",
      };
    }

    // Kiểm tra user có phải admin không
    const userMember = group.members.find(
      (m) => m.userId.toString() === userId,
    );
    if (!userMember || userMember.role !== MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 403,
        message: "Chỉ admin mới có thể thêm thành viên",
      };
    }

    // Thêm các thành viên mới
    const newMembers = memberIds.filter(
      (id) => !group.members.some((m) => m.userId.toString() === id),
    );

    if (newMembers.length === 0) {
      throw {
        statusCode: 400,
        message: "Tất cả người dùng đã là thành viên",
      };
    }

    for (const memberId of newMembers) {
      group.members.push({ userId: memberId, role: MEMBER_ROLES.MEMBER });
    }

    const updated = await group.save();
    await updated.populate("members.userId", "displayName avatar isOnline");

    // Tạo notification
    for (const memberId of newMembers) {
      await Notification.create({
        recipientId: memberId,
        senderId: userId,
        type: "group_invite",
        referenced: conversationId,
        message: `đã mời bạn vào nhóm "${group.name}".`,
      });
    }

    return updated;
  }

  /**
   * Xóa thành viên khỏi nhóm
   */
  async removeMemberFromGroup(userId, conversationId, memberId) {
    // Kiểm tra nhóm tồn tại
    const group = await Conversation.findById(conversationId);
    if (!group) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy nhóm",
      };
    }

    if (group.type !== CONVERSATION_TYPES.GROUP) {
      throw {
        statusCode: 400,
        message: "Chỉ áp dụng cho nhóm",
      };
    }

    // Kiểm tra user có phải admin không
    const userMember = group.members.find(
      (m) => m.userId.toString() === userId,
    );
    if (!userMember || userMember.role !== MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 403,
        message: "Chỉ admin mới có thể xóa thành viên",
      };
    }

    // Không cho xóa admin
    const memberToRemove = group.members.find(
      (m) => m.userId.toString() === memberId,
    );
    if (!memberToRemove) {
      throw {
        statusCode: 404,
        message: "Thành viên không tìm thấy",
      };
    }

    if (memberToRemove.role === MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 400,
        message: "Không thể xóa admin",
      };
    }

    // Xóa thành viên
    group.members = group.members.filter(
      (m) => m.userId.toString() !== memberId,
    );
    const updated = await group.save();
    await updated.populate("members.userId", "displayName avatar isOnline");

    return updated;
  }

  /**
   * Giải tán nhóm
   */
  async dissolveGroup(userId, conversationId) {
    // Kiểm tra nhóm tồn tại
    const group = await Conversation.findById(conversationId);
    if (!group) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy nhóm",
      };
    }

    if (group.type !== CONVERSATION_TYPES.GROUP) {
      throw {
        statusCode: 400,
        message: "Chỉ áp dụng cho nhóm",
      };
    }

    // Kiểm tra user có phải admin không
    const userMember = group.members.find(
      (m) => m.userId.toString() === userId,
    );
    if (!userMember || userMember.role !== MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 403,
        message: "Chỉ admin mới có thể giải tán nhóm",
      };
    }

    // Xóa tất cả tin nhắn
    await Message.deleteMany({ conversationId });

    // Xóa nhóm
    await Conversation.findByIdAndDelete(conversationId);

    return { success: true };
  }
}

module.exports = new ChatService();
