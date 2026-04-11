const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AiUsageDailySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dayKey: {
      type: String,
      required: true,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      default: "unread_summary",
      index: true,
    },
    requestCount: {
      type: Number,
      default: 0,
    },
    inputTokens: {
      type: Number,
      default: 0,
    },
    outputTokens: {
      type: Number,
      default: 0,
    },
    estimatedCostUsd: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

AiUsageDailySchema.index(
  { userId: 1, dayKey: 1, feature: 1 },
  { unique: true, name: "daily_feature_usage_unique" },
);

module.exports = mongoose.model("AiUsageDaily", AiUsageDailySchema);
