const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ReelLikeSchema = new Schema(
    {
        reelId: { type: Schema.Types.ObjectId, ref: "Reel", required: true },
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true },
);

ReelLikeSchema.index({ reelId: 1, userId: 1 }, { unique: true });
ReelLikeSchema.index({ reelId: 1 });

module.exports = mongoose.model("ReelLike", ReelLikeSchema);
