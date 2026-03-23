const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const StoryReplySchema = new Schema(
  {
    storyId: {
      type: Schema.Types.ObjectId,
      ref: "Story",
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    storyAuthorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: { type: String, required: true },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

StoryReplySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
StoryReplySchema.index({ storyId: 1, createdAt: -1 });
StoryReplySchema.index({ storyAuthorId: 1, createdAt: -1 });

module.exports = mongoose.model("StoryReply", StoryReplySchema);
