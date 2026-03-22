const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * Separate collection for reel likes.
 * Keeps the Reel document lean – no likes array stored there.
 * Unique compound index prevents duplicate likes per (user, reel) pair.
 */
const ReelLikeSchema = new Schema(
  {
    reelId: {
      type: Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate likes + fast lookup for a specific user/reel pair
ReelLikeSchema.index({ reelId: 1, userId: 1 }, { unique: true });
// Fast query "all reels liked by a user"
ReelLikeSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("ReelLike", ReelLikeSchema);
