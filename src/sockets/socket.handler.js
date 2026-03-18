const Message = require("../api/models/message.model");
const Conversation = require("../api/models/conversation.model");
const User = require("../api/models/user.model");
const Notification = require("../api/models/notification.model");

function initializeSocket(io) {
  const emitToUser = (userId, eventName, payload) => {
    if (!userId) return;
    io.to(String(userId)).emit(eventName, payload);
  };

  io.on("connection", (socket) => {
    socket.on("setup", (userId) => {
      const normalizedUserId = String(userId);
      socket.data.userId = normalizedUserId;
      socket.join(normalizedUserId);
      socket.emit("connected");
    });

    socket.on("joinRoom", ({ conversationId }) => {
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

        const sender =
          await User.findById(senderId).select("displayName avatar");
        const newMessage = new Message({
          conversationId,
          senderId,
          content: text,
          type,
        });
        let savedMessage = await newMessage.save();
        savedMessage = await savedMessage.populate(
          "senderId",
          "displayName avatar",
        );

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: {
            content: type === "image" ? "Đã gửi một ảnh" : text,
            senderId,
            senderName: sender.displayName,
            type,
            createdAt: new Date(),
          },
          updatedAt: new Date(),
        });

        io.to(conversationId).emit("newMessage", savedMessage);

        const newNoti = await Notification.create({
          recipientId: receiverId,
          senderId: senderId,
          type: "message",
          referenceId: conversationId,
          message: `đã gửi tin nhắn: ${text.substring(0, 30)}...`,
          isRead: false,
        });

        io.to(receiverId).emit("notification", {
          type: "message",
          senderName: sender.displayName,
          senderAvatar: sender.avatar,
          content: text,
          conversationId: conversationId,
          createdAt: new Date(),
        });
      } catch (error) {
        socket.emit("error", { message: "Lỗi khi gửi tin nhắn" });
      }
    });

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

    socket.on("disconnect", () => {
      // Client disconnected
    });
  });
}

module.exports = initializeSocket;
