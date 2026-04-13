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

    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },

    friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isAiBot: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ displayName: "text" }, { language_override: "none" });

module.exports = mongoose.model("User", UserSchema);
