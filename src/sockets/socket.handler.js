const Message = require("../api/models/message.model");
const Conversation = require("../api/models/conversation.model");
const User = require("../api/models/user.model");
const Notification = require("../api/models/notification.model");

// Presence tracking for multi-device / multi-tab support
const userSocketsMap = new Map(); // userId -> Set<socketId>
const socketUserMap = new Map(); // socketId -> userId

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

        const sender = await User.findById(senderId).select("displayName avatar");

        const newMessage = new Message({
          conversationId,
          senderId,
          content: text,
          type,
        });

        let savedMessage = await newMessage.save();
        savedMessage = await savedMessage.populate("senderId", "displayName avatar");

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: {
            content: type === "image" ? "Đã gửi một ảnh" : text,
            senderId,
            senderName: sender?.displayName,
            type,
            createdAt: new Date(),
          },
          updatedAt: new Date(),
        });

        io.to(conversationId).emit("newMessage", savedMessage);
        io.to(conversationId).emit("message:new", savedMessage);

        if (receiverId) {
          await Notification.create({
            recipientId: receiverId,
            senderId,
            type: "message",
            referenced: conversationId,
            message: `đã gửi tin nhắn: ${(text || "").substring(0, 30)}...`,
            isRead: false,
          });

          const notificationPayload = {
            type: "message",
            senderName: sender?.displayName,
            senderAvatar: sender?.avatar,
            content: text,
            conversationId,
            createdAt: new Date(),
          };

          io.to(receiverId).emit("notification", notificationPayload);
          io.to(receiverId).emit("notification:new", notificationPayload);
        }
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

    socket.on("accept-call", (data = {}) => {
      const fromUserId = socket.data.userId || data.fromUserId;
      const { toUserId, roomId, conversationId, callType = "video" } = data;

      if (!fromUserId || !toUserId || !roomId) {
        socket.emit("call-error", {
          message: "Thiếu dữ liệu accept-call (fromUserId, toUserId, roomId)",
        });
        return;
      }

      emitToUser(toUserId, "call-accepted", {
        fromUserId: String(fromUserId),
        toUserId: String(toUserId),
        roomId,
        conversationId,
        callType,
        acceptedAt: new Date().toISOString(),
      });
    });

    socket.on("reject-call", (data = {}) => {
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

      emitToUser(toUserId, "call-rejected", {
        fromUserId: String(fromUserId),
        toUserId: String(toUserId),
        roomId,
        conversationId,
        callType,
        reason,
        rejectedAt: new Date().toISOString(),
      });
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
