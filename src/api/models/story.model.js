const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const StorySchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    caption: { type: String, default: "" },
    privacy: {
      type: String,
      enum: ["public", "friends", "private"],
      default: "friends",
    },
    media: {
      url: { type: String, required: true },
      type: { type: String, enum: ["image", "video"], required: true },
      duration: { type: Number, default: 0 },
    },
    viewedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    reactions: [
      {
        emoji: { type: String, required: true }, // e.g., "❤️", "😂", "😮", "😢", "😡", "👍"
        users: [{ type: Schema.Types.ObjectId, ref: "User" }],
      },
    ],
    replyCount: { type: Number, default: 0 },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
StorySchema.index({ authorId: 1, createdAt: -1 });
StorySchema.index({ privacy: 1, createdAt: -1 });

module.exports = mongoose.model("Story", StorySchema);
