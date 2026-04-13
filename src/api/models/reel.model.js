const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ReelSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        videoUrl: { type: String, required: true }, // S3 key
        caption: { type: String, default: "" },
        hashtags: [{ type: String }],
        musicUrl: { type: String, default: null },
        musicTitle: { type: String, default: null },
        musicArtist: { type: String, default: null },
        viewCount: { type: Number, default: 0 },
        likeCount: { type: Number, default: 0 },
        commentCount: { type: Number, default: 0 },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true },
);

ReelSchema.index({ userId: 1, createdAt: -1 });
ReelSchema.index({ createdAt: -1 });
ReelSchema.index({ isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("Reel", ReelSchema);
