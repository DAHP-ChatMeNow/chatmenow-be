const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TransactionSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    amount: { type: Number, required: true },
    orderInfo: { type: String, required: true },
    sepayTransactionId: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: ["success", "pending", "failed"],
      default: "pending",
    },
    transactionType: {
      type: String,
      enum: ["general", "premium_purchase"],
      default: "general",
      index: true,
    },
    paymentProvider: { type: String, default: "" },
    paymentMethod: { type: String, default: "" },
    planCode: { type: String, default: "" },
    planName: { type: String, default: "" },
    planDurationDays: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    isMock: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Transaction", TransactionSchema);
