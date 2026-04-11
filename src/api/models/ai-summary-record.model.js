const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AiSummaryRecordSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    fingerprint: {
      type: String,
      required: true,
      index: true,
    },
    dayKey: {
      type: String,
      required: true,
      index: true,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    summarizedFromAt: {
      type: Date,
      default: null,
    },
    summarizedToAt: {
      type: Date,
      default: null,
    },
    summarizedMessageIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Message",
      },
    ],
    summary: {
      overview: { type: String, default: "" },
      keyPoints: [{ type: String }],
      actionItems: [{ type: String }],
      unansweredQuestions: [{ type: String }],
      urgency: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "medium",
      },
      confidence: { type: Number, default: 0 },
    },
    assistantName: {
      type: String,
      default: "DanhAI",
    },
    modelId: {
      type: String,
      default: "",
    },
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      estimatedCostUsd: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

AiSummaryRecordSchema.index({ userId: 1, conversationId: 1, createdAt: -1 });
AiSummaryRecordSchema.index({ userId: 1, dayKey: 1 });
AiSummaryRecordSchema.index(
  { userId: 1, conversationId: 1, fingerprint: 1, createdAt: -1 },
  { name: "summary_fingerprint_lookup" },
);

module.exports = mongoose.model("AiSummaryRecord", AiSummaryRecordSchema);
