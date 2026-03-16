const VideoCall = require("../models/video-call.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const {
  VIDEO_CALL_STATUS,
  REJECTION_REASON,
} = require("../../constants/video-call.constants");

class VideoCallService {
  /**
   * Initiate video call
   */
  async initiateCall(
    callerId,
    receiverId,
    callType = "video",
    conversationId = null,
  ) {
    try {
      // Check if both users exist
      const caller = await User.findById(callerId);
      const receiver = await User.findById(receiverId);

      if (!caller || !receiver) {
        throw new Error("Caller or receiver not found");
      }

      // Create video call record
      const videoCall = new VideoCall({
        callerId,
        receiverId,
        status: VIDEO_CALL_STATUS.INITIATED,
        callType,
        conversationId,
      });

      const savedCall = await videoCall.save();
      const populatedCall = await savedCall.populate([
        { path: "callerId", select: "displayName avatar email" },
        { path: "receiverId", select: "displayName avatar email" },
      ]);

      // Create notification for receiver
      await Notification.create({
        recipientId: receiverId,
        senderId: callerId,
        type: "video_call",
        referenceId: populatedCall._id,
        message: `${caller.displayName} đang gọi cho bạn`,
        isRead: false,
      });

      return {
        success: true,
        call: populatedCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Accept video call
   */
  async acceptCall(callId, receiverId) {
    try {
      const videoCall = await VideoCall.findByIdAndUpdate(
        callId,
        {
          status: VIDEO_CALL_STATUS.ACCEPTED,
          startedAt: new Date(),
        },
        { new: true },
      ).populate([
        { path: "callerId", select: "displayName avatar email" },
        { path: "receiverId", select: "displayName avatar email" },
      ]);

      if (!videoCall) {
        throw new Error("Video call not found");
      }

      return {
        success: true,
        call: videoCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reject video call
   */
  async rejectCall(callId, receiverId, reason = REJECTION_REASON.DECLINED) {
    try {
      const videoCall = await VideoCall.findByIdAndUpdate(
        callId,
        {
          status: VIDEO_CALL_STATUS.REJECTED,
          endedAt: new Date(),
        },
        { new: true },
      ).populate([
        { path: "callerId", select: "displayName avatar email" },
        { path: "receiverId", select: "displayName avatar email" },
      ]);

      if (!videoCall) {
        throw new Error("Video call not found");
      }

      return {
        success: true,
        call: videoCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * End video call and calculate duration
   */
  async endCall(callId) {
    try {
      const videoCall = await VideoCall.findById(callId);

      if (!videoCall) {
        throw new Error("Video call not found");
      }

      const endedAt = new Date();
      let duration = 0;

      if (videoCall.startedAt) {
        duration = Math.floor((endedAt - videoCall.startedAt) / 1000); // in seconds
      }

      const updatedCall = await VideoCall.findByIdAndUpdate(
        callId,
        {
          status: VIDEO_CALL_STATUS.ENDED,
          endedAt,
          duration,
        },
        { new: true },
      ).populate([
        { path: "callerId", select: "displayName avatar email" },
        { path: "receiverId", select: "displayName avatar email" },
      ]);

      return {
        success: true,
        call: updatedCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Mark call as missed
   */
  async markAsMissed(callId) {
    try {
      const videoCall = await VideoCall.findByIdAndUpdate(
        callId,
        {
          status: VIDEO_CALL_STATUS.MISSED,
          endedAt: new Date(),
        },
        { new: true },
      ).populate([
        { path: "callerId", select: "displayName avatar email" },
        { path: "receiverId", select: "displayName avatar email" },
      ]);

      return {
        success: true,
        call: videoCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get call history
   */
  async getCallHistory(userId, limit = 50, skip = 0) {
    try {
      const calls = await VideoCall.find({
        $or: [{ callerId: userId }, { receiverId: userId }],
      })
        .populate([
          { path: "callerId", select: "displayName avatar email" },
          { path: "receiverId", select: "displayName avatar email" },
        ])
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

      const total = await VideoCall.countDocuments({
        $or: [{ callerId: userId }, { receiverId: userId }],
      });

      return {
        success: true,
        calls,
        total,
        limit,
        skip,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get active call (call in progress)
   */
  async getActiveCall(userId) {
    try {
      const activeCall = await VideoCall.findOne({
        $or: [{ callerId: userId }, { receiverId: userId }],
        status: {
          $in: [
            VIDEO_CALL_STATUS.INITIATED,
            VIDEO_CALL_STATUS.RINGING,
            VIDEO_CALL_STATUS.ACCEPTED,
          ],
        },
      }).populate([
        { path: "callerId", select: "displayName avatar email" },
        { path: "receiverId", select: "displayName avatar email" },
      ]);

      return {
        success: true,
        call: activeCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get call stats for a user
   */
  async getCallStats(userId) {
    try {
      const stats = await VideoCall.aggregate([
        {
          $match: {
            $or: [{ callerId: userId }, { receiverId: userId }],
          },
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            totalDuration: { $sum: "$duration" },
            missedCalls: {
              $sum: {
                $cond: [{ $eq: ["$status", VIDEO_CALL_STATUS.MISSED] }, 1, 0],
              },
            },
            rejectedCalls: {
              $sum: {
                $cond: [{ $eq: ["$status", VIDEO_CALL_STATUS.REJECTED] }, 1, 0],
              },
            },
          },
        },
      ]);

      const result = stats[0] || {
        totalCalls: 0,
        totalDuration: 0,
        missedCalls: 0,
        rejectedCalls: 0,
      };

      return {
        success: true,
        stats: result,
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new VideoCallService();
