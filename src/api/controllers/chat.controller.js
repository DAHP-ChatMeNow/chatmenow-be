const chatService = require("../service/chat.service");
const aiService = require("../service/ai.service");
const aiSummaryService = require("../service/ai-summary.service");
const { warmupUnreadSummary } = require("../../queues/ai-summary.queue");
const Conversation = require("../models/conversation.model");

exports.getConversations = async (req, res) => {
  try {
    try {
      await aiService.getOrCreateAiConversation(req.user.userId);
    } catch (error) {
      // Ignore AI bootstrap errors to avoid breaking regular chat listing.
    }
    const conversations = await chatService.getConversations(req.user.userId);

    res.json({
      success: true,
      conversations,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getOrCreateAiConversation = async (req, res) => {
  try {
    const conversation = await aiService.getOrCreateAiConversation(
      req.user.userId,
    );

    res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.sendMessageToAi = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const result = await aiService.sendMessageToAi(senderId, req.body || {});

    const io = req.app.get("io");

    const emitMessage = (message) => {
      io.to(result.conversation._id.toString()).emit("newMessage", message);
      io.to(result.conversation._id.toString()).emit("message:new", message);

      for (const memberId of result.memberIds || []) {
        io.to(memberId).emit("newMessage", message);
        io.to(memberId).emit("message:new", message);
      }
    };

    emitMessage(result.userMessage);
    emitMessage(result.aiMessage);

    res.status(201).json({
      success: true,
      conversation: result.conversation,
      userMessage: result.userMessage,
      aiMessage: result.aiMessage,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getAiAdminConfig = async (req, res) => {
  try {
    const config = await aiService.getAiAdminConfig();

    res.status(200).json({
      success: true,
      config,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.updateAiAdminConfig = async (req, res) => {
  try {
    const result = await aiService.updateAiAdminConfig(
      req.body || {},
      req.file,
    );

    res.status(200).json({
      success: true,
      config: result.config,
      key: result.key || "",
      message: "Đã cập nhật cấu hình AI",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getAiUsageStats = async (req, res) => {
  try {
    const stats = await aiService.getAiUsageStats(req.query.days);

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

exports.getAiAvatarViewUrl = async (req, res) => {
  try {
    const result = await aiService.getAiAvatarViewUrl();

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

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit, beforeId } = req.query;

    const result = await chatService.getMessages(
      conversationId,
      req.user.userId,
      {
        limit,
        beforeId,
      },
    );

    res.status(200).json({
      success: true,
      messages: result.messages,
      total: result.total,
      limit: result.limit,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPinnedMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const result = await chatService.getPinnedMessages(
      req.user.userId,
      conversationId,
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

exports.pinMessage = async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const result = await chatService.pinMessage(
      req.user.userId,
      conversationId,
      messageId,
    );

    const io = req.app.get("io");
    if (io) {
      io.to(String(conversationId)).emit("conversation:pinned-updated", {
        conversationId,
        latestPinnedMessage: result.latestPinnedMessage,
        pinnedMessages: result.pinnedMessages,
      });
    }

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

exports.unpinMessage = async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const result = await chatService.unpinMessage(
      req.user.userId,
      conversationId,
      messageId,
    );

    const io = req.app.get("io");
    if (io) {
      io.to(String(conversationId)).emit("conversation:pinned-updated", {
        conversationId,
        latestPinnedMessage: result.latestPinnedMessage,
        pinnedMessages: result.pinnedMessages,
      });
    }

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

exports.getUnreadSummary = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { maxMessages, forceRefresh, messageIds } = req.body || {};

    const result = await aiSummaryService.getUnreadSummary(
      req.user.userId,
      conversationId,
      {
        maxMessages,
        forceRefresh,
        messageIds,
      },
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

exports.getUnreadSummaryCandidates = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit } = req.query;

    const result = await aiSummaryService.getPendingSummaryCandidates(
      req.user.userId,
      conversationId,
      { limit },
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

exports.getUnreadSummaryHistory = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { date } = req.query;

    const result = await aiSummaryService.getSummaryHistory(
      req.user.userId,
      conversationId,
      date,
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

exports.getUnreadSummaryMessages = async (req, res) => {
  try {
    const { conversationId, summaryId } = req.params;

    const result = await aiSummaryService.getSummaryMessagesByRecordId(
      req.user.userId,
      conversationId,
      summaryId,
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

exports.unsendMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId } = req.params;
    const message = await chatService.unsendMessage(userId, messageId);

    const io = req.app.get("io");
    const conversationId = message.conversationId?.toString();

    if (conversationId) {
      io.to(conversationId).emit("message:updated", message);
      io.to(conversationId).emit("message:unsent", message);
    }

    res.status(200).json({ success: true, message });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.deleteMessageForMe = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId } = req.params;
    const result = await chatService.deleteMessageForMe(userId, messageId);

    const io = req.app.get("io");
    io.to(userId).emit("message:deleted-for-me", result);

    res.status(200).json({ success: true, result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.editMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId } = req.params;
    const { content } = req.body || {};
    const message = await chatService.editMessage(userId, messageId, content);

    const io = req.app.get("io");
    const conversationId = message.conversationId?.toString();

    if (conversationId) {
      io.to(conversationId).emit("message:updated", message);
      io.to(conversationId).emit("message:edited", message);
    }

    res.status(200).json({ success: true, message });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.reactToMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId } = req.params;
    const { emoji } = req.body || {};

    const message = await chatService.reactToMessage(userId, messageId, emoji);

    const io = req.app.get("io");
    const conversationId = message.conversationId?.toString();

    if (conversationId) {

      io.to(conversationId).emit("message:updated", message);
      io.to(conversationId).emit("message:reaction", message);

    }

    res.status(200).json({ success: true, message });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { conversationId, content, attachments, type } = req.body || {};
    const aiDetection = conversationId
      ? await aiService.detectAiConversationForUser(senderId, conversationId)
      : { isAiConversation: false };

    if (aiDetection.isAiConversation) {
      if (
        (Array.isArray(attachments) && attachments.length > 0) ||
        type === "image" ||
        type === "audio" ||
        type === "file" ||
        type === "video" ||
        type === "shared_post"
      ) {
        return res.status(400).json({
          message: "Cuộc trò chuyện AI hiện chỉ hỗ trợ tin nhắn văn bản",
        });
      }

      const aiResult = await aiService.sendMessageToAi(senderId, {
        conversationId,
        content,
      });

      const io = req.app.get("io");

      const emitMessage = (message) => {
        io.to(aiResult.conversation._id.toString()).emit("newMessage", message);
        io.to(aiResult.conversation._id.toString()).emit(
          "message:new",
          message,
        );

        for (const memberId of aiResult.memberIds || []) {
          io.to(memberId).emit("newMessage", message);
          io.to(memberId).emit("message:new", message);
        }
      };

      emitMessage(aiResult.userMessage);
      emitMessage(aiResult.aiMessage);

      return res.status(201).json({
        success: true,
        conversation: aiResult.conversation,
        userMessage: aiResult.userMessage,
        aiMessage: aiResult.aiMessage,
      });
    }

    const message = await chatService.sendMessage(senderId, req.body);

    const io = req.app.get("io");
    const conversation = await Conversation.findById(message.conversationId)
      .select("members.userId")
      .lean();

    // Keep old and new event names for FE compatibility.
    io.to(message.conversationId.toString()).emit("newMessage", message);
    io.to(message.conversationId.toString()).emit("message:new", message);

    const memberIds = (conversation?.members || [])
      .map((member) => member.userId?.toString())
      .filter(Boolean);

    for (const memberId of memberIds) {
      io.to(memberId).emit("newMessage", message);
      io.to(memberId).emit("message:new", message);
    }

    if (memberIds.length > 1) {
      const recipientIds = memberIds.filter(
        (memberId) => String(memberId) !== String(senderId),
      );

      void aiSummaryService.registerPendingMessages({
        conversationId: message.conversationId,
        senderId,
        recipientIds,
        messageId: message._id,
        receivedAt: message.createdAt,
      });

      void Promise.allSettled(
        recipientIds.map((memberId) =>
            warmupUnreadSummary({
              userId: memberId,
              conversationId: message.conversationId,
            }),
          ),
      );
    }

    res.status(201).json(message);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.createGroupConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const group = await chatService.createGroupConversation(userId, req.body);

    res.status(201).json({ success: true, group });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getConversationDetails = async (req, res) => {
  try {
    const conv = await chatService.getConversationDetails(
      req.params.id,
      req.user.userId,
    );
    res.status(200).json({ success: true, conversation: conv });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.markConversationAsRead = async (req, res) => {
  try {
    const result = await chatService.markConversationAsRead(
      req.params.conversationId,
      req.user.userId,
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

exports.getOrCreatePrivateConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { partnerId } = req.params;

    const result = await chatService.getOrCreatePrivateConversation(
      userId,
      partnerId,
    );

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      conversation: result.conversation,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPrivateConversationPartner = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    const partner = await chatService.getPrivateConversationPartner(
      userId,
      conversationId,
    );

    res.status(200).json({
      success: true,
      partner,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getGroupJoinInfo = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    const info = await chatService.getGroupJoinInfo(userId, conversationId);

    res.status(200).json({
      success: true,
      ...info,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.joinGroupByLink = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    const result = await chatService.joinGroupByLink(userId, conversationId);

    res.status(200).json({
      success: true,
      conversation: result.conversation || null,
      joined: Boolean(result.joined),
      alreadyMember: Boolean(result.alreadyMember),
      requestCreated: Boolean(result.requestCreated),
      pendingApproval: Boolean(result.pendingApproval),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.addMemberToGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const { memberIds } = req.body;

    const result = await chatService.addMemberToGroup(
      userId,
      conversationId,
      memberIds,
    );

    res.status(200).json({
      success: true,
      conversation: result?.conversation || result,
      requestCreated: Boolean(result?.requestCreated),
      pendingApproval: Boolean(result?.pendingApproval),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.approveGroupMemberRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notificationId } = req.params;

    const result = await chatService.approveGroupMemberRequest(
      userId,
      notificationId,
    );

    res.status(200).json({
      success: true,
      conversation: result.conversation,
      addedCount: result.addedCount,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.removeMemberFromGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, memberId } = req.params;

    const updated = await chatService.removeMemberFromGroup(
      userId,
      conversationId,
      memberId,
    );

    res.status(200).json({ success: true, conversation: updated });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.leaveGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    const result = await chatService.leaveGroup(userId, conversationId);

    if (!result?.deleted && result?.systemMessage) {
      const io = req.app.get("io");
      io.to(String(conversationId)).emit("newMessage", result.systemMessage);
      io.to(String(conversationId)).emit("message:new", result.systemMessage);

      for (const memberId of result.remainingMemberIds || []) {
        io.to(String(memberId)).emit("newMessage", result.systemMessage);
        io.to(String(memberId)).emit("message:new", result.systemMessage);
      }
    }

    res.status(200).json({
      success: true,
      deleted: Boolean(result?.deleted),
      conversation: result?.conversation || null,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.updateGroupConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    const updated = await chatService.updateGroupConversation(
      userId,
      conversationId,
      req.body || {},
    );

    res.status(200).json({
      success: true,
      conversation: updated,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.transferGroupAdmin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const { targetUserId } = req.body || {};

    const updated = await chatService.transferGroupAdmin(
      userId,
      conversationId,
      targetUserId,
    );

    res.status(200).json({
      success: true,
      conversation: updated,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// Only admin can dissolve the group, all members will be removed and conversation will be deleted
exports.dissolveGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    await chatService.dissolveGroup(userId, conversationId);

    res.status(200).json({ success: true, message: "Đã giải tán nhóm" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.pinMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, messageId } = req.params;

    const result = await chatService.pinMessage(userId, conversationId, messageId);

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("message:pinned", {
        conversationId,
        pinnedMessages: result.pinnedMessages,
        latestPinnedMessage: result.latestPinnedMessage,
      });
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.unpinMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, messageId } = req.params;

    const result = await chatService.unpinMessage(userId, conversationId, messageId);

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("message:unpinned", {
        conversationId,
        pinnedMessages: result.pinnedMessages,
        latestPinnedMessage: result.latestPinnedMessage,
      });
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

