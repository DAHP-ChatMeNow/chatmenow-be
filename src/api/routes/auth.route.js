const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { verifyToken } = require("../middleware/authMiddleware");

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

module.exports = router;
