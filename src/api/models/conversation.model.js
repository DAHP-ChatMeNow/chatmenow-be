const mongoose = require("mongoose");
const Schema = mongoose.Schema;

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

  
  lastMessage: {
    content: { type: String, default: null },
    senderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    senderName: { type: String, default: null },
    type: { type: String, default: "text" },
    createdAt: { type: Date, default: null }
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

module.exports = mongoose.model("Conversation", ConversationSchema);
