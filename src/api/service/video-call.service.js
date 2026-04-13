const VideoCall = require("../models/video-call.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const {
  CALL_MODE,
  VIDEO_CALL_STATUS,
  REJECTION_REASON,
} = require("../../constants/video-call.constants");

class VideoCallService {
  async populateCall(call) {
    return call.populate([
      { path: "callerId", select: "displayName avatar email" },
      { path: "receiverId", select: "displayName avatar email" },
      { path: "participantIds", select: "displayName avatar email" },
      {
        path: "acceptedParticipantIds",
        select: "displayName avatar email",
      },
      {
        path: "rejectedParticipantIds",
        select: "displayName avatar email",
      },
    ]);
  }

  normalizeParticipantIds(participantIds = []) {
    if (!Array.isArray(participantIds)) {
      return [];
    }

    return [...new Set(participantIds.map(String).filter(Boolean))];
  }

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
        callMode: CALL_MODE.DIRECT,
        participantIds: [receiverId],
        status: VIDEO_CALL_STATUS.INITIATED,
        callType,
        conversationId,
      });

      const savedCall = await videoCall.save();
      const populatedCall = await this.populateCall(savedCall);

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
   * Initiate group call (additive API, does not alter direct-call flow)
   */
  async initiateGroupCall(
    callerId,
    participantIds = [],
    callType = "video",
    conversationId = null,
  ) {
    try {
      const caller = await User.findById(callerId);
      if (!caller) {
        throw new Error("Caller not found");
      }

      const normalizedParticipantIds = this.normalizeParticipantIds(
        participantIds,
      ).filter((id) => id !== String(callerId));

      if (normalizedParticipantIds.length === 0) {
        throw new Error("At least one participant is required");
      }

      const participants = await User.find({
        _id: { $in: normalizedParticipantIds },
      }).select("_id displayName");

      if (participants.length !== normalizedParticipantIds.length) {
        throw new Error("One or more participants not found");
      }

      const videoCall = new VideoCall({
        callerId,
        receiverId: null,
        callMode: CALL_MODE.GROUP,
        participantIds: normalizedParticipantIds,
        status: VIDEO_CALL_STATUS.INITIATED,
        callType,
        conversationId,
      });

      const savedCall = await videoCall.save();
      const populatedCall = await this.populateCall(savedCall);

      await Notification.insertMany(
        normalizedParticipantIds.map((participantId) => ({
          recipientId: participantId,
          senderId: callerId,
          type: "video_call",
          referenceId: populatedCall._id,
          message: `${caller.displayName} đã mời bạn tham gia cuộc gọi nhóm`,
          isRead: false,
        })),
      );

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
      const existingCall = await VideoCall.findById(callId);

      if (!existingCall) {
        throw new Error("Video call not found");
      }

      const isDirectReceiver =
        existingCall.receiverId &&
        String(existingCall.receiverId) === String(receiverId);
      const isGroupParticipant = (existingCall.participantIds || []).some(
        (participantId) => String(participantId) === String(receiverId),
      );

      if (!isDirectReceiver && !isGroupParticipant) {
        throw new Error("You are not a participant of this call");
      }

      const update = {
        $set: {
          status: VIDEO_CALL_STATUS.ACCEPTED,
        },
        $addToSet: {
          acceptedParticipantIds: receiverId,
        },
        $pull: {
          rejectedParticipantIds: receiverId,
        },
      };

      if (!existingCall.startedAt) {
        update.$set.startedAt = new Date();
      }

      const videoCall = await VideoCall.findByIdAndUpdate(callId, update, {
        new: true,
      });

      const populatedCall = await this.populateCall(videoCall);

      return {
        success: true,
        call: populatedCall,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reject video call
   */
  async rejectCall(callId, receiverId, _reason = REJECTION_REASON.DECLINED) {
    try {
      const existingCall = await VideoCall.findById(callId);
      if (!existingCall) {
        throw new Error("Video call not found");
      }

      const isDirectReceiver =
        existingCall.receiverId &&
        String(existingCall.receiverId) === String(receiverId);
      const isGroupParticipant = (existingCall.participantIds || []).some(
        (participantId) => String(participantId) === String(receiverId),
      );

      if (!isDirectReceiver && !isGroupParticipant) {
        throw new Error("You are not a participant of this call");
      }

      const endedAt = new Date();
      const totalParticipants = (existingCall.participantIds || []).length;
      const existingRejectedCount = (existingCall.rejectedParticipantIds || [])
        .map(String)
        .filter((id) => id !== String(receiverId)).length;
      const willBeAllRejected =
        totalParticipants > 0 && existingRejectedCount + 1 >= totalParticipants;

      const update = {
        $addToSet: {
          rejectedParticipantIds: receiverId,
        },
        $pull: {
          acceptedParticipantIds: receiverId,
        },
      };

      if (existingCall.callMode === CALL_MODE.DIRECT || willBeAllRejected) {
        update.$set = {
          status: VIDEO_CALL_STATUS.REJECTED,
          endedAt,
        };
      }

      const videoCall = await VideoCall.findByIdAndUpdate(callId, update, {
        new: true,
      });
      const populatedCall = await this.populateCall(videoCall);

      return {
        success: true,
        call: populatedCall,
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
      );

      const populatedCall = await this.populateCall(updatedCall);

      return {
        success: true,
        call: populatedCall,
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
      );

      const populatedCall = await this.populateCall(videoCall);

      return {
        success: true,
        call: populatedCall,
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
        $or: [
          { callerId: userId },
          { receiverId: userId },
          { participantIds: userId },
        ],
      })
        .populate([
          { path: "callerId", select: "displayName avatar email" },
          { path: "receiverId", select: "displayName avatar email" },
          { path: "participantIds", select: "displayName avatar email" },
        ])
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

      const total = await VideoCall.countDocuments({
        $or: [
          { callerId: userId },
          { receiverId: userId },
          { participantIds: userId },
        ],
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
        $or: [
          { callerId: userId },
          { receiverId: userId },
          { participantIds: userId },
        ],
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
        { path: "participantIds", select: "displayName avatar email" },
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
            $or: [
              { callerId: userId },
              { receiverId: userId },
              { participantIds: userId },
            ],
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
