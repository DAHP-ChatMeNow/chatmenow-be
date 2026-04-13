const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PostSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, default: "" },
    privacy: {
      type: String,
      enum: ["public", "friends", "custom", "private"],
      default: "public",
    },
    customAudienceIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    media: [
      {
        url: String,
        type: { type: String, enum: ["image", "video"] },
        duration: Number,
      },
    ],

    likes: [{ type: Schema.Types.ObjectId, ref: "User" }], // Array of user IDs who liked this post
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    trendingScore: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

PostSchema.index({ createdAt: -1 });
PostSchema.index({ trendingScore: -1 });
PostSchema.index({ authorId: 1 });
PostSchema.index({ privacy: 1, createdAt: -1 });
PostSchema.index({ customAudienceIds: 1, createdAt: -1 });
PostSchema.index({ isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("Post", PostSchema);
