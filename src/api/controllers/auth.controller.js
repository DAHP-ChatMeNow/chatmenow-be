const authService = require("../service/auth.service");
const otpService = require("../service/otp.service");
const Account = require("../models/account.model");
const { verifyTurnstile } = require("../service/turnstile.service");

exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Vui lòng nhập địa chỉ email." });
    }

    // Kiểm tra email đã tồn tại chưa
    const existingAccount = await Account.findOne({ email });
    if (existingAccount) {
      return res
        .status(400)
        .json({ message: "Email này đã được sử dụng." });
    }

    const result = await otpService.sendOtp(email);

    res.status(200).json({
      success: true,
      message: result.message,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const result = otpService.verifyOtp(email, otp);

    res.status(200).json({
      success: true,
      message: result.message,
      verified: result.verified,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.register = async (req, res) => {
  try {
    const result = await authService.register(req.body);

    res.status(201).json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message = field
        ? `Dữ liệu '${field}' đã tồn tại trong hệ thống.`
        : "Dữ liệu đã tồn tại trong hệ thống.";

      return res.status(409).json({
        message,
        detail: error.message,
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { turnstileToken } = req.body;
    const forwardedFor = req.headers["x-forwarded-for"];
    const remoteIp =
      typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : req.ip;

    await verifyTurnstile({
      token: turnstileToken,
      remoteIp,
    });

    const result = await authService.login(req.body);

    res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
      role: result.role,
      rememberToken: result.rememberToken,
      rememberProfile: result.rememberProfile,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.rememberedLogin = async (req, res) => {
  try {
    const result = await authService.loginWithRememberToken(req.body);

    res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
      role: result.role,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.revokeRememberedAccount = async (req, res) => {
  try {
    const result = await authService.revokeRememberedAccount(req.body);

    res.status(200).json({
      success: true,
      revoked: result.revoked,
      message: result.message,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getRememberedAccountInfo = async (req, res) => {
  try {
    const result = await authService.getRememberedAccountInfo(req.query);

    res.status(200).json({
      success: true,
      account: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await authService.getMe(req.user.userId);
    res.status(200).json(user);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    await authService.changePassword(req.user.userId, req.body);
    res.status(200).json({ message: "Tính năng đang phát triển" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.sendSelfLockOtp = async (req, res) => {
  try {
    const result = await authService.sendSelfLockOtp(req.user.accountId);
    res.status(200).json({
      success: true,
      message: result.message,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.confirmSelfLock = async (req, res) => {
  try {
    const result = await authService.confirmSelfLock(req.user.accountId, req.body);
    res.status(200).json({
      success: true,
      locked: result.locked,
      message: result.message,
      statusReason: result.statusReason,
      lockDuration: result.lockDuration,
      lockedUntil: result.lockedUntil,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.verifySelfLockOtp = async (req, res) => {
  try {
    const result = await authService.verifySelfLockOtp(req.user.accountId, req.body);
    res.status(200).json({
      success: true,
      message: result.message,
      lockVerificationToken: result.lockVerificationToken,
      expiresIn: result.expiresIn,
      expiresAt: result.expiresAt,
      verificationExpiresAt: result.verificationExpiresAt,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.sendUnlockOtp = async (req, res) => {
  try {
    const result = await authService.sendUnlockOtp(req.body);
    res.status(200).json({
      success: true,
      message: result.message,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};

exports.confirmUnlock = async (req, res) => {
  try {
    const result = await authService.confirmUnlockByOtp(req.body);
    res.status(200).json({
      success: true,
      unlocked: result.unlocked,
      message: result.message,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi server: " + error.message });
  }
};
