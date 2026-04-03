const authService = require("../service/auth.service");
const { verifyTurnstile } = require("../service/turnstile.service");

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
