const Message = require("../api/models/message.model");
const Conversation = require("../api/models/conversation.model");
const User = require("../api/models/user.model");
const aiService = require("../api/service/ai.service");
const aiSummaryService = require("../api/service/ai-summary.service");
const chatService = require("../api/service/chat.service");

// Presence tracking for multi-device / multi-tab support
const userSocketsMap = new Map(); // userId -> Set<socketId>
const socketUserMap = new Map(); // socketId -> userId
const roomParticipantsMap = new Map(); // roomId -> Map<userId, participantSnapshot>

async function persistCallHistoryMessage(io, payload) {
  const {
    conversationId,
    senderId,
    status,
    callType = "video",
    duration = 0,
    startedAt = null,
    endedAt = null,
    content = null,
    participants = [],
  } = payload || {};

  if (!conversationId || !senderId || !status) {
    return null;
  }

  const safeCallType = callType === "audio" ? "audio" : "video";
  const safeDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Math.floor(Number(duration)))
    : 0;

  let historyMessage = await Message.create({
    conversationId,
    senderId,
    content: content || status,
    type: "system",
    callInfo: {
      callType: safeCallType,
      status,
      duration: safeDuration,
      startedAt,
      endedAt,
      participants: Array.isArray(participants) ? participants : [],
    },
  });

  historyMessage = await historyMessage.populate(
    "senderId",
    "displayName avatar",
  );

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: {
      content: content || status,
      senderId,
      senderName: "Hệ thống",
      type: "system",
      createdAt: historyMessage.createdAt,
    },
    updatedAt: new Date(),
  });

  io.to(conversationId.toString()).emit("newMessage", historyMessage);
  io.to(conversationId.toString()).emit("message:new", historyMessage);

  const conversation = await Conversation.findById(conversationId)
    .select("members.userId")
    .lean();

  const memberIds = (conversation?.members || [])
    .map((member) => member.userId?.toString())
    .filter(Boolean);

  for (const memberId of memberIds) {
    io.to(memberId).emit("newMessage", historyMessage);
    io.to(memberId).emit("message:new", historyMessage);
  }

  return historyMessage;
}

async function getParticipantSnapshot(userId, joinedAt = null) {
  if (!userId) return null;

  const user = await User.findById(userId).select("displayName avatar").lean();
  if (!user) return null;

  return {
    userId: user._id,
    displayName: user.displayName || null,
    avatar: user.avatar || null,
    joinedAt,
  };
}

async function registerRoomParticipant(roomId, userId, joinedAt = new Date()) {
  if (!roomId || !userId) {
    return [];
  }

  const normalizedRoomId = String(roomId);
  const normalizedUserId = String(userId);

  const participantSnapshot = await getParticipantSnapshot(
    normalizedUserId,
    joinedAt,
  );

  if (!participantSnapshot) {
    return [];
  }

  const participants = roomParticipantsMap.get(normalizedRoomId) || new Map();
  participants.set(normalizedUserId, participantSnapshot);
  roomParticipantsMap.set(normalizedRoomId, participants);

  return Array.from(participants.values());
}

function getRoomParticipants(roomId) {
  if (!roomId) return [];
  const participants = roomParticipantsMap.get(String(roomId));
  return participants ? Array.from(participants.values()) : [];
}

function clearRoomParticipants(roomId) {
  if (!roomId) return;
  roomParticipantsMap.delete(String(roomId));
}

function initializeSocket(io) {
  const emitToUser = (userId, eventName, payload) => {
    if (!userId) return;
    io.to(String(userId)).emit(eventName, payload);
  };

  const emitToUsers = (userIds = [], eventName, payloadFactory) => {
    if (!Array.isArray(userIds)) return;

    for (const userId of userIds) {
      if (!userId) continue;
      const payload =
        typeof payloadFactory === "function"
          ? payloadFactory(String(userId))
          : payloadFactory;
      io.to(String(userId)).emit(eventName, payload);
    }
  };

  io.on("connection", (socket) => {
    socket.on("setup", async (userId) => {
      try {
        if (!userId) {
          socket.emit("error", { message: "Missing userId in setup" });
          return;
        }

        const normalizedUserId = String(userId);
        const previousUserId = socketUserMap.get(socket.id);

        if (previousUserId && previousUserId !== normalizedUserId) {
          const previousSockets = userSocketsMap.get(previousUserId);
          if (previousSockets) {
            previousSockets.delete(socket.id);
            if (previousSockets.size === 0) {
              userSocketsMap.delete(previousUserId);
            }
          }
        }

        const userSockets = userSocketsMap.get(normalizedUserId) || new Set();
        const wasOffline = userSockets.size === 0;

        userSockets.add(socket.id);
        userSocketsMap.set(normalizedUserId, userSockets);
        socketUserMap.set(socket.id, normalizedUserId);

        socket.data.userId = normalizedUserId;
        socket.join(normalizedUserId);

        if (wasOffline) {
          await User.findByIdAndUpdate(normalizedUserId, {
            isOnline: true,
          });

          io.emit("user:presence", {
            userId: normalizedUserId,
            isOnline: true,
            lastSeen: null,
          });
        }

        socket.emit("connected");
      } catch (error) {
        socket.emit("error", { message: "Lỗi setup socket" });
      }
    });

    socket.on("joinRoom", ({ conversationId }) => {
      if (!conversationId) return;
      socket.join(conversationId);
    });

    // FE uses "joinConversation" / "leaveConversation"
    socket.on("joinConversation", (conversationId) => {
      if (!conversationId) return;
      socket.join(String(conversationId));
    });

    socket.on("leaveConversation", (conversationId) => {
      if (!conversationId) return;
      socket.leave(String(conversationId));
    });

    socket.on("sendMessage", async (data) => {
      try {
        const {
          conversationId,
          text,
          senderId,
          type = "text",
          receiverId,
          replyToMessageId,
          mentionAll = false,
          mentionUserIds = [],
        } = data;

        const normalizedSenderId = socket.data.userId || senderId;

        const aiDetection = await aiService.detectAiConversationForUser(
          normalizedSenderId,
          conversationId,
        );

        if (aiDetection.isAiConversation) {
          const aiResult = await aiService.sendMessageToAi(normalizedSenderId, {
            conversationId,
            content: text,
          });

          const emitMessage = (message) => {
            io.to(conversationId).emit("newMessage", message);
            io.to(conversationId).emit("message:new", message);

            for (const memberId of aiResult.memberIds || []) {
              io.to(memberId).emit("newMessage", message);
              io.to(memberId).emit("message:new", message);
            }
          };

          emitMessage(aiResult.userMessage);
          emitMessage(aiResult.aiMessage);
          return;
        }

        const savedMessage = await chatService.sendMessage(normalizedSenderId, {
          conversationId,
          content: text,
          type,
          replyToMessageId,
          mentionAll,
          mentionUserIds,
        });

        io.to(conversationId).emit("newMessage", savedMessage);
        io.to(conversationId).emit("message:new", savedMessage);

        if (conversationId) {
          const conversation = await Conversation.findById(conversationId)
            .select("type members.userId")
            .lean();

          const recipientIds = (conversation?.members || [])
            .map((member) => String(member.userId || ""))
            .filter(
              (memberId) =>
                memberId && String(memberId) !== String(normalizedSenderId),
            );

          if (recipientIds.length > 0 && conversation?.type === "group") {
            void aiSummaryService.registerPendingMessages({
              conversationId,
              senderId: normalizedSenderId,
              recipientIds,
              messageId: savedMessage._id,
              receivedAt: savedMessage.createdAt,
            });
          }
        }

        // Do not create notification for direct messages.
      } catch (error) {
        socket.emit("error", { message: "Lỗi khi gửi tin nhắn" });
      }
    });

    // LiveKit flow: only business call-state events, no WebRTC signaling
    socket.on("call-user", (data = {}) => {
      const fromUserId = socket.data.userId || data.fromUserId;
      const { toUserId, roomId, conversationId, callType = "video" } = data;

      if (!fromUserId || !toUserId || !roomId) {
        socket.emit("call-error", {
          message: "Thiếu dữ liệu gọi điện (fromUserId, toUserId, roomId)",
        });
        return;
      }

      emitToUser(toUserId, "incoming-call", {
        fromUserId: String(fromUserId),
        toUserId: String(toUserId),
        roomId,
        conversationId,
        callType,
        createdAt: new Date().toISOString(),
      });
    });

    // Additive group-call signaling event, kept separate from existing 1-1 flow.
    socket.on("call-group", (data = {}) => {
      const fromUserId = socket.data.userId || data.fromUserId;
      const {
        toUserIds = [],
        roomId,
        conversationId,
        callType = "video",
      } = data;

      if (!fromUserId || !roomId || !Array.isArray(toUserIds)) {
        socket.emit("call-error", {
          message: "Thiếu dữ liệu gọi nhóm (fromUserId, toUserIds[], roomId)",
        });
        return;
      }

      const normalizedToUserIds = [...new Set(toUserIds.map(String))].filter(
        (userId) => userId && userId !== String(fromUserId),
      );

      if (normalizedToUserIds.length === 0) {
        socket.emit("call-error", {
          message: "Danh sách người nhận cuộc gọi nhóm không hợp lệ",
        });
        return;
      }

      const createdAt = new Date().toISOString();

      emitToUsers(
        normalizedToUserIds,
        "incoming-group-call",
        (targetUserId) => ({
          fromUserId: String(fromUserId),
          toUserId: targetUserId,
          toUserIds: normalizedToUserIds,
          roomId,
          conversationId,
          callType,
          createdAt,
        }),
      );
    });

    socket.on("accept-call", async (data = {}) => {
      try {
        const fromUserId = socket.data.userId || data.fromUserId;
        const {
          toUserId,
          toUserIds = [],
          roomId,
          conversationId,
          callType = "video",
          callMode = null,
        } = data;

        if (
          !fromUserId ||
          !roomId ||
          (!toUserId && (!Array.isArray(toUserIds) || toUserIds.length === 0))
        ) {
          socket.emit("call-error", {
            message:
              "Thiếu dữ liệu accept-call (fromUserId, roomId, toUserId|toUserIds)",
          });
          return;
        }

        const acceptedAt = new Date();

        const targetUserIds =
          Array.isArray(toUserIds) && toUserIds.length > 0
            ? [...new Set(toUserIds.map(String))]
            : [String(toUserId)];

        emitToUsers(targetUserIds, "call-accepted", (targetUserId) => ({
          fromUserId: String(fromUserId),
          toUserId: String(targetUserId),
          toUserIds: targetUserIds,
          roomId,
          conversationId,
          callType,
          acceptedAt: acceptedAt.toISOString(),
        }));

        const participants = await registerRoomParticipant(
          roomId,
          fromUserId,
          acceptedAt,
        );

        const isGroupCall =
          callMode === "group" ||
          (Array.isArray(toUserIds) && toUserIds.length > 1);

        let joinContent = null;
        if (isGroupCall) {
          const joinedUser = participants.find(
            (participant) => String(participant.userId) === String(fromUserId),
          );

          if (joinedUser?.displayName) {
            joinContent = `${joinedUser.displayName} da tham gia cuoc goi`;
          }
        }

        await persistCallHistoryMessage(io, {
          conversationId,
          senderId: fromUserId,
          status: "accepted",
          callType,
          startedAt: acceptedAt,
          content: joinContent,
        });
      } catch (error) {
        socket.emit("call-error", { message: "Lỗi khi xử lý accept-call" });
      }
    });

    socket.on("reject-call", async (data = {}) => {
      try {
        const fromUserId = socket.data.userId || data.fromUserId;
        const {
          toUserId,
          roomId,
          conversationId,
          callType = "video",
          reason = "rejected",
        } = data;

        if (!fromUserId || !toUserId || !roomId) {
          socket.emit("call-error", {
            message: "Thiếu dữ liệu reject-call (fromUserId, toUserId, roomId)",
          });
          return;
        }

        const rejectedAt = new Date();

        emitToUser(toUserId, "call-rejected", {
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          roomId,
          conversationId,
          callType,
          reason,
          rejectedAt: rejectedAt.toISOString(),
        });

        await persistCallHistoryMessage(io, {
          conversationId,
          senderId: fromUserId,
          status: "rejected",
          callType,
          endedAt: rejectedAt,
        });
      } catch (error) {
        socket.emit("call-error", { message: "Lỗi khi xử lý reject-call" });
      }
    });

    socket.on("end-call", async (data = {}) => {
      try {
        const fromUserId = socket.data.userId || data.fromUserId;
        const {
          toUserId,
          toUserIds = [],
          roomId,
          conversationId,
          callType = "video",
          duration = 0,
        } = data;

        if (
          !fromUserId ||
          !roomId ||
          (!toUserId && (!Array.isArray(toUserIds) || toUserIds.length === 0))
        ) {
          socket.emit("call-error", {
            message:
              "Thiếu dữ liệu end-call (fromUserId, roomId, toUserId|toUserIds)",
          });
          return;
        }

        const endedAt = new Date();

        const targetUserIds =
          Array.isArray(toUserIds) && toUserIds.length > 0
            ? [...new Set(toUserIds.map(String))]
            : [String(toUserId)];

        emitToUsers(targetUserIds, "call-ended", (targetUserId) => ({
          fromUserId: String(fromUserId),
          toUserId: String(targetUserId),
          toUserIds: targetUserIds,
          roomId,
          conversationId,
          callType,
          duration,
          endedAt: endedAt.toISOString(),
        }));

        const participants = getRoomParticipants(roomId);

        await persistCallHistoryMessage(io, {
          conversationId,
          senderId: fromUserId,
          status: "ended",
          callType,
          duration,
          endedAt,
          participants,
        });

        clearRoomParticipants(roomId);
      } catch (error) {
        socket.emit("call-error", { message: "Lỗi khi xử lý end-call" });
      }
    });

    socket.on("disconnect", async () => {
      const disconnectedUserId = socketUserMap.get(socket.id);
      socketUserMap.delete(socket.id);

      if (!disconnectedUserId) return;

      const sockets = userSocketsMap.get(disconnectedUserId);
      if (!sockets) return;

      sockets.delete(socket.id);
      if (sockets.size > 0) return;

      userSocketsMap.delete(disconnectedUserId);
      const now = new Date();

      await User.findByIdAndUpdate(disconnectedUserId, {
        isOnline: false,
        lastSeen: now,
      });

      io.emit("user:presence", {
        userId: disconnectedUserId,
        isOnline: false,
        lastSeen: now,
      });
    });
  });
}

module.exports = initializeSocket;
