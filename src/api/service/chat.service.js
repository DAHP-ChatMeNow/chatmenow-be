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

  normalizeReplyToMessageId(replyToMessageId) {
    if (replyToMessageId == null) {
      return null;
    }

    const normalizedReplyId = String(replyToMessageId).trim();
    if (!normalizedReplyId) {
      return null;
    }

    if (!mongoose.Types.ObjectId.isValid(normalizedReplyId)) {
      throw {
        statusCode: 400,
        message: "replyToMessageId không hợp lệ",
      };
    }

    return normalizedReplyId;
  }

  async resolveReplyTarget(conversationId, replyToMessageId) {
    const normalizedReplyId = this.normalizeReplyToMessageId(replyToMessageId);
    if (!normalizedReplyId) {
      return {
        replyToMessageId: null,
        replyPreview: null,
      };
    }

    const replyTarget = await Message.findById(normalizedReplyId)
      .select("_id conversationId isUnsent content type attachments senderId")
      .populate("senderId", "displayName")
      .lean();

    if (!replyTarget || String(replyTarget.conversationId) !== String(conversationId)) {
      throw {
        statusCode: 400,
        message: "Tin nhắn được trả lời không hợp lệ",
      };
    }

    if (replyTarget.isUnsent) {
      throw {
        statusCode: 400,
        message: "Không thể trả lời tin nhắn đã được thu hồi",
      };
    }

    return {
      replyToMessageId: normalizedReplyId,
      replyPreview: {
        content: String(replyTarget.content || ""),
        type: String(replyTarget.type || MESSAGE_TYPES.TEXT),
        attachments: Array.isArray(replyTarget.attachments)
          ? replyTarget.attachments
          : [],
        senderDisplayName: String(replyTarget.senderId?.displayName || ""),
      },
    };
  }

  normalizeMessageId(messageId, fieldName = "messageId") {
    const normalized = String(messageId || "").trim();
    if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
      throw {
        statusCode: 400,
        message: `${fieldName} không hợp lệ`,
      };
    }

    return normalized;
  }

  async buildPinnedMessagesPayload(conversationId, userId) {
    const conversation = await this.ensureConversationMember(conversationId, userId);
    const pinnedEntries = Array.isArray(conversation.pinnedMessages)
      ? [...conversation.pinnedMessages]
      : [];

    if (pinnedEntries.length === 0) {
      return {
        pinnedMessages: [],
        latestPinnedMessage: null,
      };
    }

    const sortedEntries = pinnedEntries.sort(
      (left, right) =>
        new Date(right?.pinnedAt || 0).getTime() -
        new Date(left?.pinnedAt || 0).getTime(),
    );

    const messageIds = sortedEntries
      .map((entry) => String(entry?.messageId || ""))
      .filter(Boolean);

    if (messageIds.length === 0) {
      return {
        pinnedMessages: [],
        latestPinnedMessage: null,
      };
    }

    const pinnedMessages = await Message.find({
      _id: { $in: messageIds },
      conversationId,
      deletedFor: { $ne: userId },
      isUnsent: { $ne: true },
    })
      .populate("senderId", "displayName avatar")
      .lean();

    const messageMap = new Map(
      pinnedMessages.map((message) => [String(message._id), message]),
    );

    const normalizedPinnedMessages = sortedEntries
      .map((entry) => {
        const messageId = String(entry?.messageId || "");
        const message = messageMap.get(messageId);
        if (!message) {
          return null;
        }

        return {
          messageId,
          pinnedAt: entry?.pinnedAt || null,
          pinnedBy: entry?.pinnedBy || null,
          message,
        };
      })
      .filter(Boolean);

    return {
      pinnedMessages: normalizedPinnedMessages,
      latestPinnedMessage: normalizedPinnedMessages[0]?.message || null,
    };
  }

  async ensureConversationMember(conversationId, userId) {
    const conversation = await Conversation.findById(conversationId)
      .select(
        "_id type pinManagementEnabled pinnedMessages members.userId members.role members.lastReadAt",
      )
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

  ensureCanManagePinnedMessages(conversation, userId) {
    if (!conversation || conversation.type !== CONVERSATION_TYPES.GROUP) {
      return;
    }

    // Group pin-management is optional: off => every member can pin/unpin.
    if (!conversation.pinManagementEnabled) {
      return;
    }

    const member = this.getConversationMember(conversation, userId);
    if (!member || member.role !== MEMBER_ROLES.ADMIN) {
      throw {
        statusCode: 403,
        message: "Nhóm đang bật quản lý ghim: chỉ admin mới có thể ghim hoặc bỏ ghim tin nhắn",
      };
    }
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
      .populate("senderId", "displayName avatar")
      .populate({
        path: "replyToMessageId",
        select: "content type attachments isUnsent unsentAt senderId",
        populate: {
          path: "senderId",
          select: "displayName avatar",
        },
      });

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
    {
      conversationId,
      content,
      type = MESSAGE_TYPES.TEXT,
      attachments = [],
      replyToMessageId = null,
    },
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
    const resolvedReplyTarget = await this.resolveReplyTarget(
      conversationId,
      replyToMessageId,
    );

    const safeReplyToMessageId =
      typeof resolvedReplyTarget === "object" && resolvedReplyTarget !== null
        ? resolvedReplyTarget.replyToMessageId
        : resolvedReplyTarget;
        
    const safeReplyPreview = 
      typeof resolvedReplyTarget === "object" && resolvedReplyTarget !== null
        ? resolvedReplyTarget.replyPreview
        : null;

    const message = await Message.create({
      conversationId,
      senderId,
      content: trimmedContent,
      type: resolvedType,
      attachments: normalizedAttachments,
      replyToMessageId: safeReplyToMessageId,
      replyPreview: safeReplyPreview,
      readBy: [senderId],
    });

    await message.populate("senderId", "displayName avatar");
    await message.populate({
      path: "replyToMessageId",
      select: "content type attachments isUnsent unsentAt senderId",
      populate: {
        path: "senderId",
        select: "displayName avatar",
      },
    });

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
    message.replyPreview = null;
    message.isEdited = false;
    message.editedAt = null;

    await message.save();
    await Conversation.updateOne(
      { _id: message.conversationId },
      {
        $pull: {
          pinnedMessages: {
            messageId: message._id,
          },
        },
      },
    );
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

  async pinMessage(userId, conversationId, messageId) {
    const normalizedMessageId = this.normalizeMessageId(messageId);
    const conversation = await this.ensureConversationMember(conversationId, userId);
    this.ensureCanManagePinnedMessages(conversation, userId);

    const targetMessage = await Message.findOne({
      _id: normalizedMessageId,
      conversationId,
      deletedFor: { $ne: userId },
    })
      .select("_id isUnsent")
      .lean();

    if (!targetMessage) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy tin nhắn để ghim",
      };
    }

    if (targetMessage.isUnsent) {
      throw {
        statusCode: 400,
        message: "Không thể ghim tin nhắn đã thu hồi",
      };
    }

    await Conversation.updateOne(
      { _id: conversationId },
      {
        $pull: {
          pinnedMessages: {
            messageId: normalizedMessageId,
          },
        },
      },
    );

    await Conversation.updateOne(
      { _id: conversationId },
      {
        $push: {
          pinnedMessages: {
            messageId: normalizedMessageId,
            pinnedBy: userId,
            pinnedAt: new Date(),
          },
        },
      },
    );

    return this.buildPinnedMessagesPayload(conversationId, userId);
  }

  async unpinMessage(userId, conversationId, messageId) {
    const normalizedMessageId = this.normalizeMessageId(messageId);
    const conversation = await this.ensureConversationMember(conversationId, userId);
    this.ensureCanManagePinnedMessages(conversation, userId);

    await Conversation.updateOne(
      { _id: conversationId },
      {
        $pull: {
          pinnedMessages: {
            messageId: normalizedMessageId,
          },
        },
      },
    );

    return this.buildPinnedMessagesPayload(conversationId, userId);
  }

  async getPinnedMessages(userId, conversationId) {
    return this.buildPinnedMessagesPayload(conversationId, userId);
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
  async updateGroupConversation(
    userId,
    conversationId,
    { name, groupAvatar, pinManagementEnabled, joinApprovalEnabled } = {},
  ) {
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

    if (typeof pinManagementEnabled === "boolean") {
      group.pinManagementEnabled = pinManagementEnabled;
    }

    if (typeof joinApprovalEnabled === "boolean") {
      group.joinApprovalEnabled = joinApprovalEnabled;
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

    const isMember = (conv.members || []).some(
      (member) => String(member?.userId?._id || member?.userId) === String(userId),
    );

    if (!isMember) {
      throw {
        statusCode: 403,
        message: "Bạn chưa tham gia nhóm này",
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

  async getGroupJoinInfo(userId, conversationId) {
    const conversation = await Conversation.findById(conversationId)
      .select("_id type name groupAvatar joinApprovalEnabled members.userId")
      .lean();

    if (!conversation) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy nhóm",
      };
    }

    if (conversation.type !== CONVERSATION_TYPES.GROUP) {
      throw {
        statusCode: 400,
        message: "Liên kết này không phải nhóm",
      };
    }

    const isMember = (conversation.members || []).some(
      (member) => String(member?.userId) === String(userId),
    );

    return {
      conversationId: String(conversation._id),
      name: conversation.name || "Nhóm chat",
      groupAvatar: conversation.groupAvatar || "",
      memberCount: Array.isArray(conversation.members)
        ? conversation.members.length
        : 0,
      isMember,
      joinApprovalEnabled: Boolean(conversation.joinApprovalEnabled),
    };
  }

  async joinGroupByLink(userId, conversationId) {
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
        message: "Liên kết này không phải nhóm",
      };
    }

    const alreadyMember = (group.members || []).some(
      (member) => String(member.userId) === String(userId),
    );

    if (alreadyMember) {
      await group.populate("members.userId", "displayName avatar isOnline");

      return {
        conversation: group,
        joined: false,
        alreadyMember: true,
        requestCreated: false,
        pendingApproval: false,
      };
    }

    if (group.joinApprovalEnabled) {
      const adminIds = (group.members || [])
        .filter((member) => member.role === MEMBER_ROLES.ADMIN)
        .map((member) => String(member.userId))
        .filter(Boolean);

      if (adminIds.length === 0) {
        throw {
          statusCode: 400,
          message: "Không tìm thấy admin để duyệt yêu cầu tham gia",
        };
      }

      const existingPendingRequest = await Notification.findOne({
        senderId: userId,
        type: NOTIFICATION_TYPES.GROUP_MEMBER_REQUEST,
        referenced: conversationId,
        "metadata.requestType": "join_group",
        "metadata.status": "pending",
      }).lean();

      if (existingPendingRequest) {
        return {
          conversation: null,
          joined: false,
          alreadyMember: false,
          requestCreated: true,
          pendingApproval: true,
        };
      }

      const requestId = new mongoose.Types.ObjectId().toString();

      await Notification.insertMany(
        adminIds.map((adminId) => ({
          recipientId: adminId,
          senderId: userId,
          type: NOTIFICATION_TYPES.GROUP_MEMBER_REQUEST,
          referenced: conversationId,
          message: `đã gửi yêu cầu tham gia nhóm "${group.name}".`,
          metadata: {
            requestId,
            requestType: "join_group",
            conversationId: String(conversationId),
            memberIds: [String(userId)],
            status: "pending",
          },
        })),
      );

      return {
        conversation: null,
        joined: false,
        alreadyMember: false,
        requestCreated: true,
        pendingApproval: true,
      };
    }

    group.members.push({
      userId,
      role: MEMBER_ROLES.MEMBER,
    });
    await group.save();

    await group.populate("members.userId", "displayName avatar isOnline");

    return {
      conversation: group,
      joined: true,
      alreadyMember: false,
      requestCreated: false,
      pendingApproval: false,
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
