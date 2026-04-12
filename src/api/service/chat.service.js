const mongoose = require("mongoose");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const {
  CONVERSATION_TYPES,
  MESSAGE_TYPES,
  MEMBER_ROLES,
  NOTIFICATION_TYPES,
} = require("../../constants");
const { formatLastSeen } = require("../../utils/last-seen.helper");

class ChatService {
  extractMemberUserId(member) {
    const rawUserId = member?.userId;
    if (!rawUserId) return null;
    if (typeof rawUserId === "string") return rawUserId;
    return String(rawUserId?._id || rawUserId?.id || rawUserId);
  }

  getPrivatePartnerId(conversation, userId) {
    if (!conversation || conversation.type !== CONVERSATION_TYPES.PRIVATE) {
      return null;
    }

    const partnerMember = (conversation.members || []).find((member) => {
      const memberUserId = this.extractMemberUserId(member);
      return !!memberUserId && String(memberUserId) !== String(userId);
    });

    return partnerMember ? this.extractMemberUserId(partnerMember) : null;
  }

  buildBlockMeta(blockedByMe, blockedByOther) {
    return {
      isBlocked: Boolean(blockedByMe || blockedByOther),
      blockedByMe: Boolean(blockedByMe),
      blockedByOther: Boolean(blockedByOther),
      blockReason: blockedByMe
        ? "Bạn đã chặn người này"
        : blockedByOther
          ? "Người này đã chặn bạn"
          : null,
    };
  }

  async getPrivateConversationBlockMeta(conversation, userId) {
    const partnerId = this.getPrivatePartnerId(conversation, userId);
    if (!partnerId) {
      return this.buildBlockMeta(false, false);
    }

    const [currentUser, partner] = await Promise.all([
      User.findById(userId).select("blockedUsers").lean(),
      User.findById(partnerId).select("blockedUsers").lean(),
    ]);

    const blockedByMe = (currentUser?.blockedUsers || []).some(
      (id) => String(id) === String(partnerId),
    );
    const blockedByOther = (partner?.blockedUsers || []).some(
      (id) => String(id) === String(userId),
    );

    return this.buildBlockMeta(blockedByMe, blockedByOther);
  }

  async getPrivateConversationBlockMap(conversations, userId) {
    const privateConversations = (conversations || []).filter(
      (conversation) => conversation?.type === CONVERSATION_TYPES.PRIVATE,
    );

    if (!privateConversations.length) {
      return new Map();
    }

    const conversationPartnerPairs = privateConversations
      .map((conversation) => {
        const conversationId = String(conversation?._id || conversation?.id || "");
        const partnerId = this.getPrivatePartnerId(conversation, userId);

        if (!conversationId || !partnerId) return null;
        return { conversationId, partnerId: String(partnerId) };
      })
      .filter(Boolean);

    if (!conversationPartnerPairs.length) {
      return new Map();
    }

    const uniquePartnerIds = [...new Set(conversationPartnerPairs.map((item) => item.partnerId))];
    const [currentUser, partners] = await Promise.all([
      User.findById(userId).select("blockedUsers").lean(),
      User.find({ _id: { $in: uniquePartnerIds } })
        .select("_id blockedUsers")
        .lean(),
    ]);

    const blockedByMeSet = new Set(
      (currentUser?.blockedUsers || []).map((id) => String(id)),
    );
    const blockedByOtherSet = new Set(
      (partners || [])
        .filter((partner) =>
          (partner?.blockedUsers || []).some((id) => String(id) === String(userId)),
        )
        .map((partner) => String(partner._id)),
    );

    const map = new Map();
    conversationPartnerPairs.forEach(({ conversationId, partnerId }) => {
      map.set(
        conversationId,
        this.buildBlockMeta(
          blockedByMeSet.has(partnerId),
          blockedByOtherSet.has(partnerId),
        ),
      );
    });

    return map;
  }

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
      .select("_id type members.userId")
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

  getConversationMember(conversation, userId) {
    return (conversation?.members || []).find(
      (member) => String(member.userId) === String(userId),
    );
  }

  async getConversationUnreadCount(conversationId, userId, conversationDoc) {
    const conversation =
      conversationDoc ||
      (await Conversation.findById(conversationId)
        .select("_id members.userId members.lastReadAt")
        .lean());

    if (!conversation) {
      return 0;
    }

    const member = this.getConversationMember(conversation, userId);
    if (!member) {
      return 0;
    }

    const query = {
      conversationId,
      senderId: { $ne: userId },
      deletedFor: { $ne: userId },
    };

    if (member.lastReadAt) {
      query.createdAt = { $gt: member.lastReadAt };
    }

    return Message.countDocuments(query);
  }

  async decorateConversationWithUnreadCount(conversation, userId) {
    const plainConversation =
      typeof conversation?.toObject === "function"
        ? conversation.toObject()
        : conversation;

    const unreadCount = await this.getConversationUnreadCount(
      plainConversation?._id || plainConversation?.id,
      userId,
      plainConversation,
    );

    return {
      ...plainConversation,
      unreadCount,
    };
  }

  async markConversationAsRead(conversationId, userId) {
    const conversation = await this.ensureConversationMember(
      conversationId,
      userId,
    );
    const now = new Date();
    const member = this.getConversationMember(conversation, userId);

    const readQuery = {
      conversationId,
      senderId: { $ne: userId },
      deletedFor: { $ne: userId },
    };

    if (member?.lastReadAt) {
      readQuery.createdAt = { $gt: member.lastReadAt };
    }

    await Promise.all([
      Message.updateMany(readQuery, { $addToSet: { readBy: userId } }),
      Conversation.updateOne(
        { _id: conversationId, "members.userId": userId },
        {
          $set: {
            "members.$.lastReadAt": now,
            updatedAt: now,
          },
        },
      ),
    ]);

    return {
      conversationId,
      lastReadAt: now,
      unreadCount: 0,
    };
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

    const aiBotUsers = await User.find({ isAiBot: true }).select("_id").lean();
    const aiBotIdSet = new Set(aiBotUsers.map((user) => String(user._id)));

    const dedupedConversations = [];
    let hasIncludedAiConversation = false;

    for (const conversation of conversations) {
      const isPrivate = conversation?.type === CONVERSATION_TYPES.PRIVATE;
      const memberIds = (conversation?.members || [])
        .map((member) => this.extractMemberUserId(member))
        .filter(Boolean);
      const hasAiMember = memberIds.some((id) => aiBotIdSet.has(String(id)));
      const isAiConversation = isPrivate && (conversation?.isAiAssistant || hasAiMember);

      if (isAiConversation) {
        if (hasIncludedAiConversation) {
          continue;
        }
        hasIncludedAiConversation = true;
      }

      dedupedConversations.push(conversation);
    }

    const blockMap = await this.getPrivateConversationBlockMap(
      dedupedConversations,
      userId,
    );

    return Promise.all(
      dedupedConversations.map(async (conversation) => {
        const decorated = await this.decorateConversationWithUnreadCount(
          conversation,
          userId,
        );
        const conversationId = String(decorated?._id || decorated?.id || "");
        const blockMeta = blockMap.get(conversationId);

        return blockMeta ? { ...decorated, ...blockMeta } : decorated;
      }),
    );
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
    const conversation = await this.ensureConversationMember(
      conversationId,
      senderId,
    );

    if (conversation.type === CONVERSATION_TYPES.PRIVATE) {
      const blockMeta = await this.getPrivateConversationBlockMeta(
        conversation,
        senderId,
      );

      if (blockMeta.isBlocked) {
        throw {
          statusCode: 403,
          message: blockMeta.blockedByMe
            ? "Bạn đã chặn người này. Hãy mở chặn để tiếp tục trò chuyện"
            : "Bạn không thể nhắn tin vì người này đã chặn bạn",
        };
      }
    }

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
      readBy: [senderId],
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
   * Cập nhật thông tin nhóm
   */
  async updateGroupConversation(userId, conversationId, { name, groupAvatar } = {}) {
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

    const currentAdmin = group.members.find(
      (m) =>
        m.userId.toString() === String(userId) &&
        m.role === MEMBER_ROLES.ADMIN,
    );

    if (!currentAdmin) {
      throw {
        statusCode: 403,
        message: "Chỉ admin mới có thể cập nhật thông tin nhóm",
      };
    }

    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (trimmedName) {
      group.name = trimmedName;
    }

    if (typeof groupAvatar === "string") {
      group.groupAvatar = groupAvatar.trim();
    }

    const updated = await group.save();
    await updated.populate("members.userId", "displayName avatar isOnline");

    return updated;
  }

  /**
   * Lấy chi tiết conversation
   */
  async getConversationDetails(conversationId, userId) {
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

    const decorated = await this.decorateConversationWithUnreadCount(
      conv,
      userId,
    );

    if (conv.type !== CONVERSATION_TYPES.PRIVATE) {
      return decorated;
    }

    const blockMeta = await this.getPrivateConversationBlockMeta(conv, userId);
    return {
      ...decorated,
      ...blockMeta,
    };
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

    // Kiểm tra user có trong nhóm không
    const userMember = group.members.find(
      (m) => m.userId.toString() === userId,
    );
    if (!userMember) {
      throw {
        statusCode: 403,
        message: "Bạn không phải thành viên của nhóm",
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

    // Admin: thêm trực tiếp như hiện tại
    if (userMember.role === MEMBER_ROLES.ADMIN) {
      for (const memberId of newMembers) {
        group.members.push({ userId: memberId, role: MEMBER_ROLES.MEMBER });
      }

      const updated = await group.save();
      await updated.populate("members.userId", "displayName avatar isOnline");

      for (const memberId of newMembers) {
        await Notification.create({
          recipientId: memberId,
          senderId: userId,
          type: NOTIFICATION_TYPES.GROUP_INVITE,
          referenced: conversationId,
          message: `đã mời bạn vào nhóm "${group.name}".`,
        });
      }

      return {
        conversation: updated,
        requestCreated: false,
        pendingApproval: false,
      };
    }

    // Member thường: tạo yêu cầu để admin duyệt
    const adminMembers = group.members.filter(
      (m) => m.role === MEMBER_ROLES.ADMIN && m.userId.toString() !== userId,
    );

    if (adminMembers.length === 0) {
      throw {
        statusCode: 400,
        message: "Không tìm thấy nhóm trưởng để duyệt yêu cầu",
      };
    }

    const requestId = new mongoose.Types.ObjectId().toString();

    await Notification.insertMany(
      adminMembers.map((admin) => ({
        recipientId: admin.userId,
        senderId: userId,
        type: NOTIFICATION_TYPES.GROUP_MEMBER_REQUEST,
        referenced: conversationId,
        message: `đã gửi yêu cầu thêm ${newMembers.length} thành viên vào nhóm "${group.name}".`,
        metadata: {
          requestId,
          conversationId: String(conversationId),
          memberIds: newMembers,
          status: "pending",
        },
      })),
    );

    await group.populate("members.userId", "displayName avatar isOnline");

    return {
      conversation: group,
      requestCreated: true,
      pendingApproval: true,
    };
  }

  async approveGroupMemberRequest(adminUserId, notificationId) {
    const requestNotification = await Notification.findOne({
      _id: notificationId,
      recipientId: adminUserId,
      type: NOTIFICATION_TYPES.GROUP_MEMBER_REQUEST,
    });

    if (!requestNotification) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy yêu cầu thêm thành viên",
      };
    }

    const requestMeta = requestNotification.metadata || {};
    if (requestMeta.status && requestMeta.status !== "pending") {
      throw {
        statusCode: 400,
        message: "Yêu cầu này đã được xử lý",
      };
    }

    const targetConversationId =
      requestMeta.conversationId || String(requestNotification.referenced || "");
    const requestedMemberIds = Array.isArray(requestMeta.memberIds)
      ? requestMeta.memberIds.map((id) => String(id))
      : [];

    if (!targetConversationId || requestedMemberIds.length === 0) {
      throw {
        statusCode: 400,
        message: "Dữ liệu yêu cầu không hợp lệ",
      };
    }

    const group = await Conversation.findById(targetConversationId);
    if (!group || group.type !== CONVERSATION_TYPES.GROUP) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy nhóm",
      };
    }

    const adminMember = group.members.find(
      (m) =>
        m.userId.toString() === String(adminUserId) &&
        m.role === MEMBER_ROLES.ADMIN,
    );

    if (!adminMember) {
      throw {
        statusCode: 403,
        message: "Chỉ admin mới có quyền duyệt",
      };
    }

    const membersToAdd = requestedMemberIds.filter(
      (id) => !group.members.some((m) => m.userId.toString() === id),
    );

    for (const memberId of membersToAdd) {
      group.members.push({ userId: memberId, role: MEMBER_ROLES.MEMBER });
    }

    const updated = await group.save();
    await updated.populate("members.userId", "displayName avatar isOnline");

    if (membersToAdd.length > 0) {
      await Notification.insertMany(
        membersToAdd.map((memberId) => ({
          recipientId: memberId,
          senderId: adminUserId,
          type: NOTIFICATION_TYPES.GROUP_INVITE,
          referenced: targetConversationId,
          message: `đã duyệt và thêm bạn vào nhóm "${group.name}".`,
        })),
      );
    }

    if (requestMeta.requestId) {
      await Notification.updateMany(
        {
          type: NOTIFICATION_TYPES.GROUP_MEMBER_REQUEST,
          "metadata.requestId": requestMeta.requestId,
        },
        {
          $set: {
            isRead: true,
            "metadata.status": "approved",
          },
        },
      );
    } else {
      await Notification.findByIdAndUpdate(requestNotification._id, {
        $set: {
          isRead: true,
          "metadata.status": "approved",
        },
      });
    }

    return {
      conversation: updated,
      addedCount: membersToAdd.length,
    };
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
   * Thành viên tự rời nhóm
   */
  async leaveGroup(userId, conversationId) {
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

    const leavingMember = group.members.find(
      (m) => m.userId.toString() === String(userId),
    );

    if (!leavingMember) {
      throw {
        statusCode: 403,
        message: "Bạn không phải thành viên của nhóm",
      };
    }

    if (leavingMember.role === MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 400,
        message:
          "Bạn đang là admin nhóm nên không thể rời nhóm. Hãy chuyển quyền admin trước.",
      };
    }

    group.members = group.members.filter(
      (m) => m.userId.toString() !== String(userId),
    );

    if (group.members.length === 0) {
      await Message.deleteMany({ conversationId });
      await Conversation.findByIdAndDelete(conversationId);

      return {
        deleted: true,
      };
    }

    const leavingUser = await User.findById(userId).select("displayName");
    const leavingName = leavingUser?.displayName || "Người dùng";
    const systemContent = `${leavingName} đã rời khỏi nhóm`;

    const systemMessage = await Message.create({
      conversationId,
      senderId: userId,
      content: systemContent,
      type: MESSAGE_TYPES.SYSTEM,
    });

    group.lastMessage = {
      content: systemContent,
      senderId: userId,
      senderName: leavingName,
      type: MESSAGE_TYPES.SYSTEM,
      createdAt: systemMessage.createdAt,
    };

    const updated = await group.save();
    await updated.populate("members.userId", "displayName avatar isOnline");
    await systemMessage.populate("senderId", "displayName avatar");

    return {
      deleted: false,
      conversation: updated,
      systemMessage,
      remainingMemberIds: updated.members.map((member) =>
        member.userId?._id
          ? member.userId._id.toString()
          : member.userId.toString(),
      ),
    };
  }

  /**
   * Chuyển quyền admin cho một thành viên trong nhóm
   */
  async transferGroupAdmin(userId, conversationId, targetUserId) {
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

    const currentAdmin = group.members.find(
      (m) =>
        m.userId.toString() === String(userId) &&
        m.role === MEMBER_ROLES.ADMIN,
    );

    if (!currentAdmin) {
      throw {
        statusCode: 403,
        message: "Chỉ admin mới có thể chuyển quyền",
      };
    }

    const targetMember = group.members.find(
      (m) => m.userId.toString() === String(targetUserId),
    );

    if (!targetMember) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy thành viên cần chuyển quyền",
      };
    }

    if (targetMember.role === MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 400,
        message: "Thành viên này đã là admin",
      };
    }

    targetMember.role = MEMBER_ROLES.ADMIN;
    currentAdmin.role = MEMBER_ROLES.MEMBER;

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
