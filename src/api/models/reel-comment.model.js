const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ReelCommentSchema = new Schema(
    {
        reelId: { type: Schema.Types.ObjectId, ref: "Reel", required: true },
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        content: { type: String, required: true },
        replyToCommentId: { type: Schema.Types.ObjectId, ref: "ReelComment", default: null },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true },
);

ReelCommentSchema.index({ reelId: 1, createdAt: 1 });

module.exports = mongoose.model("ReelComment", ReelCommentSchema);
