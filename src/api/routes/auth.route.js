const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { verifyToken } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimiter");

// Rate limiters for password reset endpoints
const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,            // 5 requests per IP
  keyFn: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    return typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.ip;
  },
  message: "Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau.",
});

const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,           // 10 attempts per IP
  keyFn: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    return typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.ip;
  },
  message: "Quá nhiều lần thử đặt lại mật khẩu. Vui lòng thử lại sau.",
});

router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);
router.post("/register", authController.register);

router.post("/login", authController.login);

router.post("/remembered-login", authController.rememberedLogin);

router.post(
  "/remembered-account/revoke",
  authController.revokeRememberedAccount,
);

router.get("/remembered-account", authController.getRememberedAccountInfo);

router.get("/me", verifyToken, authController.getMe);

router.put("/change-password", verifyToken, authController.changePassword);
router.post("/account-lock/send-otp", verifyToken, authController.sendSelfLockOtp);
router.post("/account-lock/verify-otp", verifyToken, authController.verifySelfLockOtp);
router.post("/account-lock/confirm", verifyToken, authController.confirmSelfLock);
router.post("/account-unlock/send-otp", authController.sendUnlockOtp);
router.post("/account-unlock/confirm", authController.confirmUnlock);

// Password reset routes (public — no verifyToken)
router.post("/forgot-password", forgotPasswordLimiter, authController.forgotPassword);
router.post("/reset-password", resetPasswordLimiter, authController.resetPassword);

module.exports = router;

