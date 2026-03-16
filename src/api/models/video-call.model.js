const mongoose = require("mongoose");
const {
  CALL_TYPE,
  VIDEO_CALL_STATUS,
} = require("../../constants/video-call.constants");

const videoCallSchema = new mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    callType: {
      type: String,
      enum: Object.values(CALL_TYPE),
      default: CALL_TYPE.VIDEO,
    },
    status: {
      type: String,
      enum: Object.values(VIDEO_CALL_STATUS),
      default: VIDEO_CALL_STATUS.INITIATED,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Index for queries
videoCallSchema.index({ callerId: 1, createdAt: -1 });
videoCallSchema.index({ receiverId: 1, createdAt: -1 });
videoCallSchema.index({ status: 1 });

module.exports = mongoose.model("VideoCall", videoCallSchema);
