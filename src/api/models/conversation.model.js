const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  CONVERSATION_REQUEST_STATUS,
} = require("../../constants/conversation.constants");

const ConversationSchema = new Schema({
  type: { type: String, enum: ["private", "group"], default: "private" },
  isPinned: { type: Boolean, default: false },
  isAiAssistant: { type: Boolean, default: false },
  
  
  name: { type: String }, 
  groupAvatar: { type: String },
  pinManagementEnabled: { type: Boolean, default: false },
  joinApprovalEnabled: { type: Boolean, default: false },

  members: [{
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    joinedAt: { type: Date, default: Date.now },
    role: { type: String, enum: ["member", "admin"], default: "member" },
    lastReadAt: { type: Date } 
  }],

  memberSettings: [{
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastClearedAt: { type: Date, default: null },
  }],

  
  lastMessage: {
    content: { type: String, default: null },
    senderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    senderName: { type: String, default: null },
    type: { type: String, default: "text" },
    createdAt: { type: Date, default: null }
  },

  requestStatus: {
    type: String,
    enum: Object.values(CONVERSATION_REQUEST_STATUS),
    default: CONVERSATION_REQUEST_STATUS.ACCEPTED,
  },
  requestInitiatorId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  requestRecipientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  pendingMessageCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  requestAcceptedByRecipient: {
    type: Boolean,
    default: false,
  },

  pinnedMessages: [
    {
      messageId: { type: Schema.Types.ObjectId, ref: "Message", required: true },
      pinnedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
      pinnedAt: { type: Date, default: Date.now },
    },
  ]
}, { timestamps: true });

ConversationSchema.index({ updatedAt: -1 });
ConversationSchema.index({ requestRecipientId: 1, requestStatus: 1, updatedAt: -1 });

module.exports = mongoose.model("Conversation", ConversationSchema);
