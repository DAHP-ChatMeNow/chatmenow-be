const mongoose = require("mongoose");

const AiSummaryMessageStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "summarized"],
      default: "pending",
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    summarizedAt: {
      type: Date,
      default: null,
    },
    summaryRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiSummaryRecord",
      default: null,
    },
  },
  { timestamps: true },
);

AiSummaryMessageStateSchema.index(
  { userId: 1, conversationId: 1, messageId: 1 },
  { unique: true, name: "unique_summary_message_state" },
);

AiSummaryMessageStateSchema.index({ userId: 1, conversationId: 1, status: 1, receivedAt: 1 });

module.exports = mongoose.model("AiSummaryMessageState", AiSummaryMessageStateSchema);
