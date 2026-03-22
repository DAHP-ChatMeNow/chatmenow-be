const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ReelSchema = new Schema(
  {
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    videoUrl: {
      type: String,
      required: true,
    },

    thumbnail: {
      type: String,
      default: null,
    },

    caption: {
      type: String,
      default: "",
      maxlength: 2200,
    },

    duration: {
      type: Number,
      default: 0, // seconds
    },

    privacy: {
      type: String,
      enum: ["public", "friends", "private"],
      default: "public",
    },

    stats: {
      likesCount:    { type: Number, default: 0, min: 0 },
      commentsCount: { type: Number, default: 0, min: 0 },
      sharesCount:   { type: Number, default: 0, min: 0 },
      viewsCount:    { type: Number, default: 0, min: 0 },
    },

    ranking: {
      trendingScore:   { type: Number, default: 0 },
      watchTimeTotal:  { type: Number, default: 0 }, // total seconds watched
      avgWatchPercent: { type: Number, default: 0 }, // 0 - 100
    },
  },
  { timestamps: true }
);

// Compound / single-field indexes
ReelSchema.index({ createdAt: -1 });
ReelSchema.index({ "ranking.trendingScore": -1 });
ReelSchema.index({ authorId: 1, createdAt: -1 });

// Cursor-based feed: sort by trendingScore desc, _id desc (tiebreaker)
ReelSchema.index({ "ranking.trendingScore": -1, _id: -1 });

module.exports = mongoose.model("Reel", ReelSchema);