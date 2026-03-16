/**
 * VideoCallClient - Simplified client-side WebRTC implementation
 * Usage: new VideoCallClient(socket, userId, localVideoElement, remoteVideoElement)
 */

class VideoCallClient {
  constructor(socket, userId, localVideoElement, remoteVideoElement) {
    this.socket = socket;
    this.userId = userId;
    this.localVideoElement = localVideoElement;
    this.remoteVideoElement = remoteVideoElement;

    this.peerConnection = null;
    this.localStream = null;
    this.currentCallId = null;
    this.isCallActive = false;

    this.setupSocketEventListeners();
  }

  /**
   * Setup all socket event listeners for video call
   */
  setupSocketEventListeners() {
    // Incoming call notification
    this.socket.on("call-ringing", (data) => {
      this.onCallRinging(data);
    });

    // Acceptance/Rejection notifications
    this.socket.on("call-accepted", (data) => {
      this.onCallAccepted(data);
    });

    this.socket.on("call-rejected", (data) => {
      this.onCallRejected(data);
    });

    // WebRTC Signaling
    this.socket.on("call-offer", (data) => {
      this.onCallOffer(data);
    });

    this.socket.on("call-answer", (data) => {
      this.onCallAnswer(data);
    });

    this.socket.on("ice-candidate", (data) => {
      this.onIceCandidate(data);
    });

    // Call ended
    this.socket.on("call-ended", (data) => {
      this.onCallEnded(data);
    });

    // Error handling
    this.socket.on("error", (data) => {
      console.error("[VIDEO CALL] Socket error:", data.message);
    });
  }

  /**
   * Initiate a video call (caller side)
   */
  async initiateCall(receiverId, callType = "video") {
    try {
      // Fetch local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video:
          callType === "video"
            ? { width: { max: 640 }, height: { max: 480 } }
            : false,
        audio: true,
      });

      // Display local stream
      if (this.localVideoElement) {
        this.localVideoElement.srcObject = this.localStream;
      }

      // Make API call to create video call record
      const response = await fetch("/api/video-calls/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          receiverId: receiverId,
          callType: callType,
        }),
      });

      const { call } = await response.json();
      this.currentCallId = call._id;

      // Emit socket event to signal server
      this.socket.emit("initiate-call", {
        callId: call._id,
        callerId: this.userId,
        receiverId: receiverId,
        callType: callType,
      });

      console.log(
        `[VIDEO CALL] Call initiated to ${receiverId}, callId: ${call._id}`,
      );
    } catch (error) {
      console.error("[VIDEO CALL] Error initiating call:", error);
      throw error;
    }
  }

  /**
   * Handler for incoming call notification
   */
  onCallRinging(data) {
    const { callId, callerId, callerName, callType } = data;
    this.currentCallId = callId;

    // Trigger callback for UI to show incoming call
    if (typeof this.onIncomingCall === "function") {
      this.onIncomingCall({
        callId,
        callerId,
        callerName,
        callType,
        onAccept: () => this.acceptCall(callId),
        onReject: () => this.rejectCall(callId),
      });
    }

    // Auto-decline after 30 seconds if not accepted
    this.callTimeoutId = setTimeout(() => {
      if (!this.isCallActive) {
        console.warn("[VIDEO CALL] Call timeout - auto rejecting");
        this.rejectCall(callId, "timeout");
      }
    }, 30000);
  }

  /**
   * Accept incoming call (receiver side)
   */
  async acceptCall(callId) {
    try {
      // Clear timeout
      clearTimeout(this.callTimeoutId);

      // Fetch local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { max: 640 }, height: { max: 480 } },
        audio: true,
      });

      // Display local stream
      if (this.localVideoElement) {
        this.localVideoElement.srcObject = this.localStream;
      }

      // Update call status in database
      await fetch(`/api/video-calls/${callId}/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      // Mark call as active
      this.isCallActive = true;

      // Emit socket event
      this.socket.emit("accept-call", {
        callId: callId,
        receiverId: this.userId,
      });

      console.log(`[VIDEO CALL] Call accepted, callId: ${callId}`);
    } catch (error) {
      console.error("[VIDEO CALL] Error accepting call:", error);
      throw error;
    }
  }

  /**
   * Reject incoming call (receiver side)
   */
  async rejectCall(callId, reason = "declined") {
    try {
      // Clear timeout
      clearTimeout(this.callTimeoutId);

      // Update call status in database
      await fetch(`/api/video-calls/${callId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ reason }),
      });

      // Emit socket event
      this.socket.emit("reject-call", {
        callId: callId,
        reason: reason,
      });

      console.log(`[VIDEO CALL] Call rejected, reason: ${reason}`);
    } catch (error) {
      console.error("[VIDEO CALL] Error rejecting call:", error);
    }
  }

  /**
   * Handler for call acceptance from receiver
   */
  async onCallAccepted(data) {
    const { callId, receiverName } = data;
    console.log(`[VIDEO CALL] Call accepted by ${receiverName}`);

    // Setup peer connection and create offer
    await this.setupPeerConnection(callId, true);
  }

  /**
   * Handler for call rejection
   */
  onCallRejected(data) {
    const { callId, reason } = data;
    console.log(`[VIDEO CALL] Call rejected, reason: ${reason}`);

    // Cleanup
    this.cleanup();

    // Trigger callback
    if (typeof this.onCallRejected === "function") {
      this.onCallRejected({ callId, reason });
    }
  }

  /**
   * Setup RTCPeerConnection (called by both caller and receiver)
   */
  async setupPeerConnection(callId, isCaller) {
    try {
      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          {
            urls: ["stun:stun.l.google.com:19302"],
          },
        ],
      });

      // Add local stream tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          this.peerConnection.addTrack(track, this.localStream);
        });
      }

      // Handle remote stream
      this.peerConnection.ontrack = (event) => {
        console.log(
          "[PEER CONNECTION] Remote track received:",
          event.track.kind,
        );
        if (this.remoteVideoElement) {
          this.remoteVideoElement.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit("ice-candidate", {
            callId: callId,
            candidate: event.candidate,
            from: isCaller ? "caller" : "receiver",
          });
        }
      };

      // Monitor connection state
      this.peerConnection.onconnectionstatechange = () => {
        console.log(
          "[PEER CONNECTION] State changed:",
          this.peerConnection.connectionState,
        );

        if (this.peerConnection.connectionState === "connected") {
          console.log("[VIDEO CALL] P2P connection established!");
          // Trigger callback for connected state
          if (typeof this.onCallConnected === "function") {
            this.onCallConnected();
          }
        } else if (
          this.peerConnection.connectionState === "failed" ||
          this.peerConnection.connectionState === "closed"
        ) {
          this.cleanup();
        }
      };

      // Caller: Create and send offer
      if (isCaller) {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        this.socket.emit("call-offer", {
          callId: callId,
          offer: this.peerConnection.localDescription,
        });

        console.log("[SIGNALING] Offer sent");
      }
    } catch (error) {
      console.error("[PEER CONNECTION] Error setting up connection:", error);
      throw error;
    }
  }

  /**
   * Handler for receiving WebRTC offer (receiver side)
   */
  async onCallOffer(data) {
    const { callId, offer } = data;
    console.log("[SIGNALING] Offer received");

    try {
      // Setup peer connection if not already done
      if (!this.peerConnection) {
        await this.setupPeerConnection(callId, false);
      }

      // Set remote description
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer),
      );

      // Create and send answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.socket.emit("call-answer", {
        callId: callId,
        answer: this.peerConnection.localDescription,
      });

      console.log("[SIGNALING] Answer sent");
    } catch (error) {
      console.error("[SIGNALING] Error handling offer:", error);
    }
  }

  /**
   * Handler for receiving WebRTC answer (caller side)
   */
  async onCallAnswer(data) {
    const { callId, answer } = data;
    console.log("[SIGNALING] Answer received");

    try {
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer),
        );
      }
    } catch (error) {
      console.error("[SIGNALING] Error handling answer:", error);
    }
  }

  /**
   * Handler for receiving ICE candidates
   */
  async onIceCandidate(data) {
    const { callId, candidate } = data;

    try {
      if (this.peerConnection && candidate) {
        await this.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate),
        );
      }
    } catch (error) {
      console.error("[SIGNALING] Error adding ICE candidate:", error);
    }
  }

  /**
   * End video call
   */
  async endCall() {
    try {
      if (this.currentCallId) {
        // Update call status in database
        await fetch(`/api/video-calls/${this.currentCallId}/end`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });

        // Notify other party
        this.socket.emit("end-call", {
          callId: this.currentCallId,
        });
      }

      // Cleanup
      this.cleanup();

      console.log("[VIDEO CALL] Call ended");
    } catch (error) {
      console.error("[VIDEO CALL] Error ending call:", error);
    }
  }

  /**
   * Handler for remote end call
   */
  onCallEnded(data) {
    const { callId, reason } = data;
    console.log("[VIDEO CALL] Remote party ended call");

    // Cleanup
    this.cleanup();

    // Trigger callback
    if (typeof this.onRemoteCallEnded === "function") {
      this.onRemoteCallEnded({ callId, reason });
    }
  }

  /**
   * Cleanup: Stop all media tracks and close peer connection
   */
  cleanup() {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.localStream = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Clear DOM
    if (this.localVideoElement) {
      this.localVideoElement.srcObject = null;
    }
    if (this.remoteVideoElement) {
      this.remoteVideoElement.srcObject = null;
    }

    this.isCallActive = false;
    this.currentCallId = null;
    clearTimeout(this.callTimeoutId);
  }

  /**
   * Get call history
   */
  async getCallHistory(limit = 50, skip = 0) {
    try {
      const response = await fetch(
        `/api/video-calls/history?limit=${limit}&skip=${skip}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );
      return await response.json();
    } catch (error) {
      console.error("[VIDEO CALL] Error fetching call history:", error);
      throw error;
    }
  }

  /**
   * Get call statistics
   */
  async getCallStats() {
    try {
      const response = await fetch("/api/video-calls/stats", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      return await response.json();
    } catch (error) {
      console.error("[VIDEO CALL] Error fetching call stats:", error);
      throw error;
    }
  }
}

// Export for use in frontend
if (typeof module !== "undefined" && module.exports) {
  module.exports = VideoCallClient;
}
