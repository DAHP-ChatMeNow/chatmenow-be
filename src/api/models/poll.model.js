const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PollOptionSchema = new Schema(
  {
    text: { type: String, required: true, maxlength: 200 },
    votes: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        votedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { _id: true },
);

const PollSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    question: { type: String, required: true, maxlength: 200 },
    options: [PollOptionSchema],

    // Settings
    allowMultipleChoices: { type: Boolean, default: false },
    allowAddOptions: { type: Boolean, default: false },
    hideResultsBeforeVote: { type: Boolean, default: false },
    hideVoters: { type: Boolean, default: false },

    // Deadline
    deadline: { type: Date, default: null },

    isClosed: { type: Boolean, default: false },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PollSchema.index({ conversationId: 1, createdAt: -1 });
PollSchema.index({ messageId: 1 }, { sparse: true });

module.exports = mongoose.model("Poll", PollSchema);
