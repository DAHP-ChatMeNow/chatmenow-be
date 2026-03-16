const { Server } = require("socket.io");
const Message = require("../api/models/message.model");
const Conversation = require("../api/models/conversation.model");
const User = require("../api/models/user.model");
const Notification = require("../api/models/notification.model");
const VideoCall = require("../api/models/video-call.model");
const videoCallService = require("../api/service/video-call.service");
const { SOCKET_EVENTS } = require("../constants/video-call.constants");

// Store active calls: { callId: { callerId, receiverId, callerSocket, receiverSocket } }
const activeCallsMap = new Map();

// ==================== HELPER FUNCTIONS ====================

/**
 * Normalize call ID from various formats
 * Supports: data.callId, data._id, data.id, data.call.id, data.call._id
 */
function normalizeCallId(data) {
  if (!data) return null;
  return (
    data.callId ||
    data._id ||
    data.id ||
    (data.call && (data.call.id || data.call._id || data.call.callId)) ||
    null
  );
}

/**
 * Extract user IDs with support for multiple key formats
 */
function extractUserIds(data) {
  const callerId =
    data.callerId ||
    data.from ||
    data.fromUserId ||
    (data.caller && (data.caller.id || data.caller._id));
  const receiverId =
    data.receiverId ||
    data.to ||
    data.toUserId ||
    data.targetUserId ||
    (data.receiver && (data.receiver.id || data.receiver._id));
  return { callerId, receiverId };
}

/**
 * Create standardized signaling payload with alias keys
 * This helps handle compatibility with different FE implementations
 */
function createSignalingPayload(basePayload) {
  return {
    ...basePayload,
    // Add multiple key aliases for FE compatibility
    _id: basePayload.callId,
    id: basePayload.callId,
    call: {
      id: basePayload.callId,
      _id: basePayload.callId,
      callId: basePayload.callId,
    },
  };
}

function initializeSocket(io) {
  io.on("connection", (socket) => {
    socket.on("setup", (userId) => {
      socket.join(userId);
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

    // ==================== VIDEO CALL SIGNALING ====================

    /**
     * Event: Initiate video call
     * Emitted by: Caller (User A)
     * Flow: A -> Server -> B (as call-ringing)
     */
    socket.on(SOCKET_EVENTS.INITIATE_CALL, async (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const { callerId, receiverId } = extractUserIds(data);
        const callType = data.callType || "video";

        if (!callerId || !receiverId) {
          socket.emit("error", { message: "Missing callerId or receiverId" });
          return;
        }

        const caller =
          await User.findById(callerId).select("displayName avatar");
        if (!caller) {
          socket.emit("error", { message: "Caller not found" });
          return;
        }

        // Store call in map
        activeCallsMap.set(callId, {
          callId,
          callerId,
          receiverId,
          callerSocket: socket.id,
          receiverSocket: null,
          callType,
        });

        // Notify receiver with standardized payload + aliases
        const ringtonePayload = createSignalingPayload({
          callId,
          callerId,
          receiverId,
          callerName: caller.displayName,
          callerAvatar: caller.avatar,
          callType,
          // Add aliases for FE compatibility
          from: callerId,
          fromUserId: callerId,
          to: receiverId,
          toUserId: receiverId,
        });

        io.to(receiverId).emit(SOCKET_EVENTS.CALL_RINGING, ringtonePayload);

        console.log(
          `[VIDEO CALL] Call initiated: ${callerId} -> ${receiverId} (callId: ${callId})`,
        );
      } catch (error) {
        console.error("Error initiating call:", error);
        socket.emit("error", { message: "Failed to initiate call" });
      }
    });

    /**
     * Event: Accept video call
     * Emitted by: Receiver (User B)
     * Flow: B -> Server -> A (as call-accepted)
     * After this, WebRTC signaling begins
     */
    socket.on(SOCKET_EVENTS.ACCEPT_CALL, async (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const { callerId, receiverId: extractedReceiverId } =
          extractUserIds(data);
        const receiverId = extractedReceiverId || data.receiverId;

        if (!receiverId) {
          socket.emit("error", { message: "Missing receiverId" });
          return;
        }

        const callData = activeCallsMap.get(callId);
        if (!callData) {
          socket.emit("error", { message: "Call not found" });
          return;
        }

        callData.receiverSocket = socket.id;
        activeCallsMap.set(callId, callData);

        const receiver =
          await User.findById(receiverId).select("displayName avatar");

        // ✅ CRITICAL FIX: Emit "call-accepted" (acknowledgment) to CALLER, NOT "accept-call" (action)
        // This is what the caller is listening for to start WebRTC signaling
        const acceptedPayload = createSignalingPayload({
          callId,
          callerId: callData.callerId,
          receiverId,
          receiverName: receiver.displayName,
          receiverAvatar: receiver.avatar,
          // Add aliases for FE compatibility
          from: receiverId,
          fromUserId: receiverId,
          to: callData.callerId,
          toUserId: callData.callerId,
          targetUserId: callData.callerId,
        });

        io.to(callData.callerSocket).emit(
          SOCKET_EVENTS.CALL_ACCEPTED,
          acceptedPayload,
        );

        console.log(
          `[VIDEO CALL] Call accepted: ${callData.callerId} <- ${receiverId} (callId: ${callId})`,
        );
      } catch (error) {
        console.error("Error accepting call:", error);
        socket.emit("error", { message: "Failed to accept call" });
      }
    });

    /**
     * Event: Reject video call
     * Emitted by: Receiver (User B)
     * Flow: B -> Server -> A (as call-rejected)
     */
    socket.on(SOCKET_EVENTS.REJECT_CALL, async (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const { callerId, receiverId: extractedReceiverId } =
          extractUserIds(data);
        const receiverId = extractedReceiverId || data.receiverId;
        const reason = data.reason || "declined";

        const callData = activeCallsMap.get(callId);
        if (!callData) {
          socket.emit("error", { message: "Call not found" });
          return;
        }

        // ✅ CRITICAL FIX: Emit "call-rejected" (acknowledgment) to CALLER, NOT "reject-call"
        const rejectedPayload = createSignalingPayload({
          callId,
          callerId: callData.callerId,
          receiverId: receiverId || callData.receiverId,
          reason,
          // Add aliases for FE compatibility
          from: receiverId || callData.receiverId,
          fromUserId: receiverId || callData.receiverId,
          to: callData.callerId,
          toUserId: callData.callerId,
        });

        io.to(callData.callerSocket).emit(
          SOCKET_EVENTS.CALL_REJECTED,
          rejectedPayload,
        );

        // Clean up
        activeCallsMap.delete(callId);

        console.log(
          `[VIDEO CALL] Call rejected: ${callData.callerId} <- ${receiverId || callData.receiverId} (reason: ${reason})`,
        );
      } catch (error) {
        console.error("Error rejecting call:", error);
        socket.emit("error", { message: "Failed to reject call" });
      }
    });

    /**
     * Event: WebRTC Offer
     * Emitted by: Caller (after receiver accepts)
     * Flow: A -> Server -> B
     * This is the SDP offer describing caller's media capabilities
     */
    socket.on(SOCKET_EVENTS.CALL_OFFER, (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const { offer } = data;
        if (!offer) {
          socket.emit("error", { message: "Missing offer" });
          return;
        }

        const callData = activeCallsMap.get(callId);
        if (!callData) {
          socket.emit("error", { message: "Call not found" });
          return;
        }

        // Forward offer to receiver with standardized payload
        const offerPayload = createSignalingPayload({
          callId,
          offer,
          from: "caller",
          to: "receiver",
        });

        io.to(callData.receiverSocket).emit(
          SOCKET_EVENTS.CALL_OFFER,
          offerPayload,
        );

        console.log(`[SIGNALING] Offer sent for call ${callId}`);
      } catch (error) {
        console.error("Error sending offer:", error);
        socket.emit("error", { message: "Failed to send offer" });
      }
    });

    /**
     * Event: WebRTC Answer
     * Emitted by: Receiver (in response to offer)
     * Flow: B -> Server -> A
     * This is the SDP answer describing receiver's media capabilities
     */
    socket.on(SOCKET_EVENTS.CALL_ANSWER, (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const { answer } = data;
        if (!answer) {
          socket.emit("error", { message: "Missing answer" });
          return;
        }

        const callData = activeCallsMap.get(callId);
        if (!callData) {
          socket.emit("error", { message: "Call not found" });
          return;
        }

        // Forward answer to caller with standardized payload
        const answerPayload = createSignalingPayload({
          callId,
          answer,
          from: "receiver",
          to: "caller",
        });

        io.to(callData.callerSocket).emit(
          SOCKET_EVENTS.CALL_ANSWER,
          answerPayload,
        );

        console.log(`[SIGNALING] Answer sent for call ${callId}`);
      } catch (error) {
        console.error("Error sending answer:", error);
        socket.emit("error", { message: "Failed to send answer" });
      }
    });

    /**
     * Event: ICE Candidate
     * Emitted by: Both parties (continuously during call setup)
     * Flow: A <-> Server <-> B
     * ICE candidates are used for network connectivity
     */
    socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const { candidate, from } = data;
        if (!candidate) {
          socket.emit("error", { message: "Missing ICE candidate" });
          return;
        }

        const callData = activeCallsMap.get(callId);
        if (!callData) {
          socket.emit("error", { message: "Call not found" });
          return;
        }

        // Determine target socket
        const targetSocket =
          from === "caller" ? callData.receiverSocket : callData.callerSocket;

        // Forward ICE candidate with standardized payload
        const candidatePayload = createSignalingPayload({
          callId,
          candidate,
          from,
        });

        io.to(targetSocket).emit(SOCKET_EVENTS.ICE_CANDIDATE, candidatePayload);

        console.log(`[SIGNALING] ICE candidate sent for call ${callId}`);
      } catch (error) {
        console.error("Error sending ICE candidate:", error);
        socket.emit("error", { message: "Failed to send ICE candidate" });
      }
    });

    /**
     * Event: End video call
     * Emitted by: Either party
     * Flow: A/B -> Server -> B/A
     */
    /**
     * Event: End video call
     * Emitted by: Either party
     * Flow: A/B -> Server -> B/A
     */
    socket.on(SOCKET_EVENTS.END_CALL, (data) => {
      try {
        const callId = normalizeCallId(data);
        if (!callId) {
          socket.emit("error", { message: "Invalid callId" });
          return;
        }

        const callData = activeCallsMap.get(callId);
        if (!callData) {
          socket.emit("error", { message: "Call not found" });
          return;
        }

        // Determine target socket (the other party)
        const targetSocket =
          socket.id === callData.callerSocket
            ? callData.receiverSocket
            : callData.callerSocket;

        if (targetSocket) {
          // Notify other party with standardized payload
          const endedPayload = createSignalingPayload({
            callId,
            reason: data.reason || "call ended",
          });

          io.to(targetSocket).emit(SOCKET_EVENTS.CALL_ENDED, endedPayload);
        }

        // Clean up
        activeCallsMap.delete(callId);

        console.log(`[VIDEO CALL] Call ended: ${callId}`);
      } catch (error) {
        console.error("Error ending call:", error);
        socket.emit("error", { message: "Failed to end call" });
      }
    });

    // ==================== DISCONNECT ====================

    socket.on("disconnect", () => {
      // Clean up active calls for this socket
      for (const [callId, callData] of activeCallsMap.entries()) {
        if (
          socket.id === callData.callerSocket ||
          socket.id === callData.receiverSocket
        ) {
          // Notify other party if still connected
          const otherSocket =
            socket.id === callData.callerSocket
              ? callData.receiverSocket
              : callData.callerSocket;

          if (otherSocket) {
            const disconnectPayload = createSignalingPayload({
              callId,
              reason: "Other party disconnected",
            });

            io.to(otherSocket).emit(
              SOCKET_EVENTS.CALL_ENDED,
              disconnectPayload,
            );
          }

          // Remove call from active map
          activeCallsMap.delete(callId);
          console.log(
            `[VIDEO CALL] Call cleaned up due to disconnect: ${callId}`,
          );
        }
      }
    });
  });
}

module.exports = initializeSocket;
