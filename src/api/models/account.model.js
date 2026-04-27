const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Schema = mongoose.Schema;

const AccountSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    phoneNumber: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isPremium: { type: Boolean, default: false },
    premiumExpiryDate: { type: Date, default: null },
    premiumPlanCode: { type: String, default: "" },
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "locked"],
      default: "active",
      index: true,
    },
    isActive: { type: Boolean, default: true },
    suspendedUntil: { type: Date, default: null },
    statusReason: { type: String, default: "" },
    statusUpdatedAt: { type: Date, default: null },

    rememberedLogins: [
      {
        sessionId: { type: String, required: true },
        deviceId: { type: String, required: true },
        deviceName: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
        lastUsedAt: { type: Date, default: Date.now },
      },
    ],

    currentSession: {
      sessionId: { type: String, default: null },
      deviceId: { type: String, default: null },
      deviceName: { type: String, default: "" },
      loggedInAt: { type: Date, default: null },
    },

    password: { type: String, required: true },
  },
  { timestamps: true },
);

AccountSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

AccountSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("Account", AccountSchema);
