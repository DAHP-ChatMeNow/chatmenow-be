const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CommentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorSource: {
      type: String,
      enum: ["user", "ai"],
      default: "user",
    },
    content: { type: String, required: true },
    replyToCommentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
  },
  { timestamps: true },
);

CommentSchema.index({ postId: 1, createdAt: 1 });

module.exports = mongoose.model("Comment", CommentSchema);
