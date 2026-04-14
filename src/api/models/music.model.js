const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Cache for music metadata fetched from Jamendo API
const MusicSchema = new Schema(
    {
        jamendoId: { type: String, required: true, unique: true },
        title: { type: String, required: true },
        artist: { type: String, default: "" },
        url: { type: String, required: true }, // Jamendo streaming URL
        coverUrl: { type: String, default: null },
        duration: { type: Number, default: 0 }, // seconds
        source: { type: String, default: "jamendo" },
        cachedAt: { type: Date, default: Date.now },
    },
    { timestamps: true },
);

MusicSchema.index({ jamendoId: 1 }, { unique: true });
MusicSchema.index({ title: "text", artist: "text" });

module.exports = mongoose.model("Music", MusicSchema);
