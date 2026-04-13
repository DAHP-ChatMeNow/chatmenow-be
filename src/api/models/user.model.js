const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const UserSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: false,
      unique: true,
      sparse: true,
    },

    displayName: { type: String, required: true },
    bio: { type: String, default: "" },
    avatar: { type: String, default: "" },
    coverImage: { type: String, default: "" },

    language: { type: String, default: "vi" },
    themeColor: { type: String, default: "light" },

    hometown: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
    gender: { type: String, default: "" },
    school: { type: String, default: "" },
    maritalStatus: { type: String, default: "" },


    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },

    friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isAiBot: { type: Boolean, default: false },
    searchHistory: [
      {
        keyword: { type: String, default: "" },
        hometown: { type: String, default: "" },
        school: { type: String, default: "" },
        lastSearchedAt: { type: Date, default: Date.now },
      },
    ],
    profileVisitHistory: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        visitedAt: { type: Date, default: Date.now },
      },
    ],
    likeHistory: [
      {
        postId: { type: Schema.Types.ObjectId, ref: "Post" },
        likedAt: { type: Date, default: Date.now },
      },
    ],
    commentHistory: [
      {
        postId: { type: Schema.Types.ObjectId, ref: "Post" },
        commentId: { type: Schema.Types.ObjectId, ref: "Comment" },
        commentedAt: { type: Date, default: Date.now },
      },
    ],
    videoViewHistory: [
      {
        sourceType: { type: String, enum: ["story", "post"], default: "story" },
        sourceId: { type: Schema.Types.ObjectId, required: true },
        viewedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ displayName: "text" }, { language_override: "none" });

module.exports = mongoose.model("User", UserSchema);
