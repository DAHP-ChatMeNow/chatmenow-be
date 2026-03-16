const videoCallService = require("../service/video-call.service");

const VideoCallController = {
  /**
   * Initiate a video call
   * POST /api/video-calls/initiate
   */
  async initiateCall(req, res) {
    try {
      const { receiverId, callType = "video", conversationId } = req.body;
      const callerId = req.user.userId; // From auth middleware

      if (!receiverId) {
        return res.status(400).json({
          success: false,
          message: "Receiver ID is required",
        });
      }

      if (callerId === receiverId) {
        return res.status(400).json({
          success: false,
          message: "Cannot call yourself",
        });
      }

      const result = await videoCallService.initiateCall(
        callerId,
        receiverId,
        callType,
        conversationId,
      );

      return res.status(201).json(result);
    } catch (error) {
      console.error("Error initiating call:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to initiate call",
      });
    }
  },

  /**
   * Accept a video call
   * POST /api/video-calls/:callId/accept
   */
  async acceptCall(req, res) {
    try {
      const { callId } = req.params;
      const receiverId = req.user.userId;

      const result = await videoCallService.acceptCall(callId, receiverId);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error accepting call:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to accept call",
      });
    }
  },

  /**
   * Reject a video call
   * POST /api/video-calls/:callId/reject
   */
  async rejectCall(req, res) {
    try {
      const { callId } = req.params;
      const { reason } = req.body;
      const receiverId = req.user.userId;

      const result = await videoCallService.rejectCall(
        callId,
        receiverId,
        reason,
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error rejecting call:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to reject call",
      });
    }
  },

  /**
   * End a video call
   * POST /api/video-calls/:callId/end
   */
  async endCall(req, res) {
    try {
      const { callId } = req.params;

      const result = await videoCallService.endCall(callId);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error ending call:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to end call",
      });
    }
  },

  /**
   * Get call history for current user
   * GET /api/video-calls/history
   */
  async getCallHistory(req, res) {
    try {
      const userId = req.user.userId;
      const { limit = 50, skip = 0 } = req.query;

      const result = await videoCallService.getCallHistory(
        userId,
        parseInt(limit),
        parseInt(skip),
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error getting call history:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get call history",
      });
    }
  },

  /**
   * Get active call
   * GET /api/video-calls/active
   */
  async getActiveCall(req, res) {
    try {
      const userId = req.user.userId;

      const result = await videoCallService.getActiveCall(userId);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error getting active call:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get active call",
      });
    }
  },

  /**
   * Get call statistics
   * GET /api/video-calls/stats
   */
  async getCallStats(req, res) {
    try {
      const userId = req.user.userId;

      const result = await videoCallService.getCallStats(userId);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error getting call stats:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get call stats",
      });
    }
  },
};

module.exports = VideoCallController;
