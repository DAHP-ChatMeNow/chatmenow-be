const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const MessageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    content: { type: String },
    type: {
      type: String,
      enum: ["text", "image", "video", "file", "system"],
      default: "text",
    },

    attachments: [
      {
        url: String,
        fileType: String,
        fileName: String,
        fileSize: Number,
      },
    ],

    replyToMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    // Optional metadata for call-history system messages.
    callInfo: {
      callId: { type: Schema.Types.ObjectId, ref: "VideoCall", default: null },
      callType: { type: String, enum: ["audio", "video"], default: null },
      status: {
        type: String,
        enum: [
          "initiated",
          "ringing",
          "accepted",
          "rejected",
          "missed",
          "ended",
        ],
        default: null,
      },
      duration: { type: Number, default: 0 },
      startedAt: { type: Date, default: null },
      endedAt: { type: Date, default: null },
    },

    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isUnsent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", MessageSchema);
