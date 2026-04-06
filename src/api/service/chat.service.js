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
  getMessagePreviewContent(message) {
    if (message.isUnsent) {
      return "Tin nhắn đã được thu hồi";
    }

    switch (message.type) {
      case MESSAGE_TYPES.IMAGE:
        return "Đã gửi một ảnh";
      case MESSAGE_TYPES.VIDEO:
        return "Đã gửi một video";
      case MESSAGE_TYPES.AUDIO:
        return "Đã gửi một bản ghi âm";
      case MESSAGE_TYPES.FILE:
        return "Đã gửi một tệp";
      case MESSAGE_TYPES.SYSTEM:
        return message.content || "Tin nhắn hệ thống";
      default:
        return message.content || "Tin nhắn";
    }
  }

  normalizeAttachments(attachments) {
    if (!attachments) {
      return [];
    }

    if (!Array.isArray(attachments)) {
      throw {
        statusCode: 400,
        message: "attachments phải là mảng",
      };
    }

    if (attachments.length > 10) {
      throw {
        statusCode: 400,
        message: "Tối đa 10 tệp đính kèm cho mỗi tin nhắn",
      };
    }

    return attachments.map((item) => {
      const url = String(item?.url || item?.key || "").trim();
      const fileType = String(item?.fileType || item?.contentType || "").trim();
      const fileName = String(item?.fileName || "").trim();
      const parsedFileSize = Number(item?.fileSize || 0);

      if (!url) {
        throw {
          statusCode: 400,
          message: "Thiếu url (hoặc key) trong attachment",
        };
      }

      if (
        item?.fileSize != null &&
        (!Number.isFinite(parsedFileSize) || parsedFileSize < 0)
      ) {
        throw {
          statusCode: 400,
          message: "fileSize trong attachment không hợp lệ",
        };
      }

      return {
        url,
        fileType,
        fileName,
        fileSize: Number.isFinite(parsedFileSize) ? parsedFileSize : 0,
      };
    });
  }

  resolveMessageType(requestedType, attachments) {
    const normalizedType = String(requestedType || "")
      .trim()
      .toLowerCase();

    if (normalizedType && normalizedType !== MESSAGE_TYPES.TEXT) {
      return normalizedType;
    }

    if (attachments.length === 0) {
      return MESSAGE_TYPES.TEXT;
    }

    const firstMime = attachments[0].fileType || "";
    if (firstMime.startsWith("image/")) {
      return MESSAGE_TYPES.IMAGE;
    }
    if (firstMime.startsWith("audio/")) {
      return MESSAGE_TYPES.AUDIO;
    }
    if (firstMime.startsWith("video/")) {
      return MESSAGE_TYPES.VIDEO;
    }

    return MESSAGE_TYPES.FILE;
  }

  validateOutgoingMessagePayload({ content, type, attachments }) {
    const trimmedContent = String(content || "").trim();
    const allowedTypes = Object.values(MESSAGE_TYPES);

    if (!allowedTypes.includes(type)) {
      throw {
        statusCode: 400,
        message: "Loại tin nhắn không hợp lệ",
      };
    }

    if (type === MESSAGE_TYPES.SYSTEM) {
      throw {
        statusCode: 400,
        message: "Không thể gửi tin nhắn hệ thống từ client",
      };
    }

    if (
      type === MESSAGE_TYPES.TEXT &&
      !trimmedContent &&
      attachments.length === 0
    ) {
      throw {
        statusCode: 400,
        message: "Nội dung tin nhắn không được để trống",
      };
    }

    if (type !== MESSAGE_TYPES.TEXT && attachments.length === 0) {
      throw {
        statusCode: 400,
        message: "Tin nhắn media phải có ít nhất 1 attachment",
      };
    }

    return trimmedContent;
  }

  async ensureConversationMember(conversationId, userId) {
    const conversation = await Conversation.findById(conversationId)
      .select("_id members.userId")
      .lean();

    if (!conversation) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy cuộc trò chuyện",
      };
    }

    const isMember = (conversation.members || []).some(
      (member) => String(member.userId) === String(userId),
    );

    if (!isMember) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền truy cập cuộc trò chuyện này",
      };
    }

    return conversation;
  }

  async refreshConversationLastMessage(conversationId) {
    const latestMessage = await Message.findOne({ conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .populate("senderId", "displayName")
      .lean();

    if (!latestMessage) {
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: null,
        updatedAt: new Date(),
      });
      return;
    }

    const senderName = latestMessage.senderId?.displayName || "Người dùng";
    const previewContent = this.getMessagePreviewContent(latestMessage);

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: {
        content: previewContent,
        senderId: latestMessage.senderId?._id || latestMessage.senderId,
        senderName,
        type: latestMessage.type,
        createdAt: latestMessage.createdAt,
      },
      updatedAt: new Date(),
    });
  }

  /**
   * Lấy danh sách cuộc trò chuyện
   */
  async getConversations(userId) {
    const conversations = await Conversation.find({
      "members.userId": userId,
    })
      .sort({ isPinned: -1, updatedAt: -1 })
      .populate("members.userId", "displayName avatar isOnline lastSeen")
      .populate("lastMessage.senderId", "displayName avatar");

    return conversations;
  }

  /**
   * Lấy tin nhắn trong conversation
   */
  async getMessages(conversationId, userId, { limit = 20, beforeId }) {
    const parsedLimit = parseInt(limit, 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    await this.ensureConversationMember(conversationId, userId);

    const query = {
      conversationId,
      deletedFor: { $ne: userId },
    };

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
  async sendMessage(
    senderId,
    { conversationId, content, type = MESSAGE_TYPES.TEXT, attachments = [] },
  ) {
    await this.ensureConversationMember(conversationId, senderId);

    const normalizedAttachments = this.normalizeAttachments(attachments);
    const resolvedType = this.resolveMessageType(type, normalizedAttachments);
    const trimmedContent = this.validateOutgoingMessagePayload({
      content,
      type: resolvedType,
      attachments: normalizedAttachments,
    });

    const message = await Message.create({
      conversationId,
      senderId,
      content: trimmedContent,
      type: resolvedType,
      attachments: normalizedAttachments,
    });

    await message.populate("senderId", "displayName avatar");

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: {
        content: this.getMessagePreviewContent(message),
        senderId,
        senderName: message.senderId.displayName,
        type: resolvedType,
        createdAt: message.createdAt,
      },
      updatedAt: new Date(),
    });

    return message;
  }

  async unsendMessage(userId, messageId) {
    const message = await Message.findById(messageId);
    if (!message) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy tin nhắn",
      };
    }

    await this.ensureConversationMember(message.conversationId, userId);

    if (String(message.senderId) !== String(userId)) {
      throw {
        statusCode: 403,
        message: "Bạn chỉ có thể thu hồi tin nhắn của chính mình",
      };
    }

    if (message.isUnsent) {
      return message;
    }

    const createdAtMs = new Date(message.createdAt).getTime();
    const nowMs = Date.now();
    const maxUnsendWindowMs = 30 * 60 * 1000;

    if (nowMs - createdAtMs > maxUnsendWindowMs) {
      throw {
        statusCode: 400,
        message: "Chỉ có thể thu hồi trong vòng 30 phút sau khi gửi",
      };
    }

    message.isUnsent = true;
    message.unsentAt = new Date();
    message.content = "Tin nhắn đã được thu hồi";
    message.attachments = [];
    message.replyToMessageId = null;
    message.isEdited = false;
    message.editedAt = null;

    await message.save();
    await message.populate("senderId", "displayName avatar");
    await this.refreshConversationLastMessage(message.conversationId);

    return message;
  }

  async deleteMessageForMe(userId, messageId) {
    const message = await Message.findById(messageId);
    if (!message) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy tin nhắn",
      };
    }

    await this.ensureConversationMember(message.conversationId, userId);

    await Message.updateOne(
      { _id: messageId },
      { $addToSet: { deletedFor: userId } },
    );

    return {
      _id: messageId,
      conversationId: message.conversationId,
      deletedForUserId: userId,
    };
  }

  async editMessage(userId, messageId, content) {
    const trimmedContent = String(content || "").trim();
    if (!trimmedContent) {
      throw {
        statusCode: 400,
        message: "Nội dung tin nhắn không được để trống",
      };
    }

    const message = await Message.findById(messageId);
    if (!message) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy tin nhắn",
      };
    }

    await this.ensureConversationMember(message.conversationId, userId);

    if (String(message.senderId) !== String(userId)) {
      throw {
        statusCode: 403,
        message: "Bạn chỉ có thể sửa tin nhắn của chính mình",
      };
    }

    if (message.isUnsent) {
      throw {
        statusCode: 400,
        message: "Không thể sửa tin nhắn đã thu hồi",
      };
    }

    if (message.type !== "text") {
      throw {
        statusCode: 400,
        message: "Chỉ hỗ trợ sửa tin nhắn văn bản",
      };
    }

    if (message.senderSource === "ai") {
      throw {
        statusCode: 400,
        message: "Không thể sửa tin nhắn AI",
      };
    }

    message.content = trimmedContent;
    message.isEdited = true;
    message.editedAt = new Date();

    await message.save();
    await message.populate("senderId", "displayName avatar");
    await this.refreshConversationLastMessage(message.conversationId);

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
