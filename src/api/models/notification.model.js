const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  NOTIFICATION_TYPES,
} = require("../../constants/notification.constants");

const NotificationSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User" },

    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    referenced: { type: Schema.Types.ObjectId },

    message: { type: String },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

NotificationSchema.index({ recipientId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
