const Message = require("../api/models/message.model");
const Conversation = require("../api/models/conversation.model");
const User = require("../api/models/user.model");
const aiService = require("../api/service/ai.service");
const aiSummaryService = require("../api/service/ai-summary.service");

// Presence tracking for multi-device / multi-tab support
const userSocketsMap = new Map(); // userId -> Set<socketId>
const socketUserMap = new Map(); // socketId -> userId

async function persistCallHistoryMessage(io, payload) {
  const {
    conversationId,
    senderId,
    status,
    callType = "video",
    duration = 0,
    startedAt = null,
    endedAt = null,
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
    content: status,
    type: "system",
    callInfo: {
      callType: safeCallType,
      status,
      duration: safeDuration,
      startedAt,
      endedAt,
    },
  });

  historyMessage = await historyMessage.populate(
    "senderId",
    "displayName avatar",
  );

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: {
      content: status,
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

function initializeSocket(io) {
  const emitToUser = (userId, eventName, payload) => {
    if (!userId) return;
    io.to(String(userId)).emit(eventName, payload);
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

    socket.on("sendMessage", async (data) => {
      try {
        const {
          conversationId,
          text,
          senderId,
          type = "text",
          receiverId,
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

        const sender =
          await User.findById(normalizedSenderId).select("displayName avatar");

        const newMessage = new Message({
          conversationId,
          senderId: normalizedSenderId,
          content: text,
          type,
          readBy: [normalizedSenderId],
        });

        let savedMessage = await newMessage.save();
        savedMessage = await savedMessage.populate(
          "senderId",
          "displayName avatar",
        );

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: {
            content: type === "image" ? "Đã gửi một ảnh" : text,
            senderId: normalizedSenderId,
            senderName: sender?.displayName,
            type,
            createdAt: new Date(),
          },
          updatedAt: new Date(),
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

    socket.on("accept-call", async (data = {}) => {
      try {
        const fromUserId = socket.data.userId || data.fromUserId;
        const { toUserId, roomId, conversationId, callType = "video" } = data;

        if (!fromUserId || !toUserId || !roomId) {
          socket.emit("call-error", {
            message: "Thiếu dữ liệu accept-call (fromUserId, toUserId, roomId)",
          });
          return;
        }

        const acceptedAt = new Date();

        emitToUser(toUserId, "call-accepted", {
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          roomId,
          conversationId,
          callType,
          acceptedAt: acceptedAt.toISOString(),
        });

        await persistCallHistoryMessage(io, {
          conversationId,
          senderId: fromUserId,
          status: "accepted",
          callType,
          startedAt: acceptedAt,
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
          roomId,
          conversationId,
          callType = "video",
          duration = 0,
        } = data;

        if (!fromUserId || !toUserId || !roomId) {
          socket.emit("call-error", {
            message: "Thiếu dữ liệu end-call (fromUserId, toUserId, roomId)",
          });
          return;
        }

        const endedAt = new Date();

        emitToUser(toUserId, "call-ended", {
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          roomId,
          conversationId,
          callType,
          duration,
          endedAt: endedAt.toISOString(),
        });

        await persistCallHistoryMessage(io, {
          conversationId,
          senderId: fromUserId,
          status: "ended",
          callType,
          duration,
          endedAt,
        });
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
