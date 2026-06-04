const Account = require("../models/account.model");
const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getSignedUrlFromS3 } = require("../middleware/storage");
const { generateDefaultAvatar } = require("../../utils/avatar.helper");
const otpService = require("./otp.service");
const emailService = require("./email.service");

const SELF_LOCK_VERIFY_SESSION_MS = 5 * 60 * 1000;
const selfLockVerifySessionStore = new Map();

// Password reset rate limiting — max 3 requests per email per 15 minutes
const PASSWORD_RESET_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_MAX_REQUESTS = 3;
const passwordResetRateLimitStore = new Map();

class AuthService {
  createSelfLockVerifySession(accountId) {
    const token = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + SELF_LOCK_VERIFY_SESSION_MS;

    selfLockVerifySessionStore.set(token, {
      accountId: accountId.toString(),
      createdAt: now,
      expiresAt,
    });

    setTimeout(() => {
      selfLockVerifySessionStore.delete(token);
    }, SELF_LOCK_VERIFY_SESSION_MS);

    return {
      token,
      expiresIn: Math.floor(SELF_LOCK_VERIFY_SESSION_MS / 1000),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  consumeSelfLockVerifySession(accountId, token) {
    if (!token) {
      throw {
        statusCode: 400,
        message: "Thiếu lockVerificationToken.",
      };
    }

    const session = selfLockVerifySessionStore.get(token);
    if (!session) {
      throw {
        statusCode: 400,
        message:
          "Phiên xác thực OTP đã hết hạn hoặc không hợp lệ. Vui lòng gửi lại OTP.",
      };
    }

    if (session.accountId !== accountId.toString()) {
      selfLockVerifySessionStore.delete(token);
      throw {
        statusCode: 403,
        message: "Phiên xác thực OTP không thuộc về tài khoản hiện tại.",
      };
    }

    if (session.expiresAt <= Date.now()) {
      selfLockVerifySessionStore.delete(token);
      throw {
        statusCode: 400,
        message:
          "Phiên xác thực OTP đã hết hạn. Vui lòng gửi lại OTP để tiếp tục.",
      };
    }

    selfLockVerifySessionStore.delete(token);
  }

  getSelfLockReason(reason, otherReason = "") {
    const reasonMap = {
      temporary_leave: "Tạm thời không sử dụng",
      security_concern: "Nghi ngờ bảo mật tài khoản",
      privacy_break: "Muốn tạm dừng vì lý do riêng tư",
      other: "Lý do khác",
    };

    const normalizedReason = (reason || "").toString().toLowerCase().trim();

    if (!normalizedReason) {
      return "Tự khóa tạm thời (không cung cấp lý do)";
    }

    if (!reasonMap[normalizedReason]) {
      throw {
        statusCode: 400,
        message: "Lý do tạm khóa không hợp lệ.",
      };
    }

    if (normalizedReason === "other") {
      const cleanOtherReason = (otherReason || "").toString().trim();
      if (!cleanOtherReason) {
        return "Tự khóa tạm thời - Lý do khác";
      }

      return `Tự khóa tạm thời - ${cleanOtherReason.slice(0, 300)}`;
    }

    return `Tự khóa tạm thời - ${reasonMap[normalizedReason]}`;
  }

  async buildAvatarViewUrl(avatar) {
    if (!avatar) return "";

    if (
      avatar.startsWith("http://") ||
      avatar.startsWith("https://") ||
      avatar.startsWith("data:")
    ) {
      return avatar;
    }

    return await getSignedUrlFromS3(avatar);
  }

  async getActiveAccountOrThrow(account) {
    if (!account) {
      throw {
        statusCode: 401,
        message: "Email hoặc mật khẩu không đúng.",
      };
    }

    if (account.accountStatus === "suspended" && account.suspendedUntil) {
      if (new Date(account.suspendedUntil).getTime() <= Date.now()) {
        account.accountStatus = "active";
        account.isActive = true;
        account.suspendedUntil = null;
        account.statusReason = "";
        account.statusUpdatedAt = new Date();
        await account.save();
      }
    }

    if (account.accountStatus === "locked" || account.isActive === false) {
      throw {
        statusCode: 403,
        message: "Tài khoản đã bị khóa.",
      };
    }

    if (account.accountStatus === "suspended") {
      throw {
        statusCode: 403,
        message: "Tài khoản đang bị đình chỉ.",
      };
    }

    return account;
  }

  generateToken(accountId, userId, sessionId, deviceId) {
    return jwt.sign(
      { accountId, userId, sessionId, deviceId },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d",
      },
    );
  }

  async createCurrentSession(accountId, deviceId, deviceName = "") {
    const sessionId = crypto.randomUUID();
    const loggedInAt = new Date();

    await Account.updateOne(
      { _id: accountId },
      {
        $set: {
          currentSession: {
            sessionId,
            deviceId,
            deviceName,
            loggedInAt,
          },
        },
      },
    );

    return {
      sessionId,
      loggedInAt,
    };
  }

  async revokeRememberedLoginsExceptDevice(accountId, deviceId) {
    if (!deviceId) {
      return;
    }

    await Account.updateOne(
      { _id: accountId },
      {
        $pull: {
          rememberedLogins: {
            deviceId: { $ne: deviceId },
          },
        },
      },
    );
  }

  generateRememberToken(accountId, userId, deviceId, sessionId) {
    return jwt.sign(
      {
        type: "remember_login",
        role: "user",
        accountId,
        userId,
        deviceId,
        sessionId,
      },
      process.env.JWT_REMEMBER_SECRET || process.env.JWT_SECRET,
      { expiresIn: "180d" },
    );
  }

  verifyRememberToken(rememberToken) {
    try {
      return jwt.verify(
        rememberToken,
        process.env.JWT_REMEMBER_SECRET || process.env.JWT_SECRET,
      );
    } catch {
      throw {
        statusCode: 401,
        message: "rememberToken không hợp lệ hoặc đã hết hạn.",
      };
    }
  }

  async register({ displayName, email, password }) {
    if (!displayName || !email || !password) {
      throw {
        statusCode: 400,
        message:
          "Vui lòng điền đầy đủ thông tin (displayName, email, password)",
      };
    }

    const existingAccount = await Account.findOne({ email });
    if (existingAccount) {
      throw {
        statusCode: 400,
        message: "Email này đã được sử dụng.",
      };
    }

    // Kiểm tra OTP đã được xác thực chưa
    if (!otpService.isOtpVerified(email)) {
      throw {
        statusCode: 400,
        message: "Vui lòng xác thực OTP trước khi đăng ký.",
      };
    }

    const newAccount = await Account.create({
      email,
      password,
      role: "user",
    });

    const newUser = await User.create({
      accountId: newAccount._id,
      displayName: displayName,
      avatar: generateDefaultAvatar(displayName),
    });

    const defaultDeviceId = `register-${crypto.randomUUID()}`;
    const session = await this.createCurrentSession(
      newAccount._id,
      defaultDeviceId,
      "register",
    );

    const token = this.generateToken(
      newAccount._id,
      newUser._id,
      session.sessionId,
      defaultDeviceId,
    );

    // Xóa OTP sau khi đăng ký thành công
    otpService.clearOtp(email);

    return {
      token,
      user: newUser,
    };
  }

  async login({
    email,
    password,
    rememberAccount = false,
    deviceId,
    deviceName = "",
  }) {
    if (!deviceId) {
      throw {
        statusCode: 400,
        message: "Thiếu deviceId cho đăng nhập.",
      };
    }

    const account = await this.getActiveAccountOrThrow(
      await Account.findOne({ email }),
    );

    const isMatch = await account.comparePassword(password);
    if (!isMatch) {
      throw {
        statusCode: 401,
        message: "Email hoặc mật khẩu không đúng.",
      };
    }

    const user = await User.findOne({ accountId: account._id });
    const session = await this.createCurrentSession(
      account._id,
      deviceId,
      deviceName,
    );
    await this.revokeRememberedLoginsExceptDevice(account._id, deviceId);

    const token = this.generateToken(
      account._id,
      user._id,
      session.sessionId,
      deviceId,
    );

    const response = {
      token,
      user,
      role: account.role,
    };

    // Chỉ user được hỗ trợ tính năng ghi nhớ tài khoản.
    if (account.role === "user" && rememberAccount) {
      if (!deviceId) {
        throw {
          statusCode: 400,
          message: "Thiếu deviceId cho tính năng ghi nhớ tài khoản.",
        };
      }

      const sessionId = crypto.randomUUID();
      const now = new Date();

      await Account.findByIdAndUpdate(account._id, {
        $pull: { rememberedLogins: { deviceId } },
      });

      await Account.findByIdAndUpdate(account._id, {
        $push: {
          rememberedLogins: {
            sessionId,
            deviceId,
            deviceName,
            createdAt: now,
            lastUsedAt: now,
          },
        },
      });

      response.rememberToken = this.generateRememberToken(
        account._id,
        user._id,
        deviceId,
        sessionId,
      );
      response.rememberProfile = {
        userId: user._id,
        displayName: user.displayName,
        avatar: user.avatar,
        email: account.email,
        deviceId,
      };
    }

    return response;
  }

  async loginWithRememberToken({ rememberToken, deviceId }) {
    if (!rememberToken || !deviceId) {
      throw {
        statusCode: 400,
        message: "Thiếu rememberToken hoặc deviceId.",
      };
    }

    const payload = this.verifyRememberToken(rememberToken);

    if (payload.type !== "remember_login" || payload.role !== "user") {
      throw {
        statusCode: 403,
        message: "Token ghi nhớ không hợp lệ cho luồng này.",
      };
    }

    if (payload.deviceId !== deviceId) {
      throw {
        statusCode: 403,
        message: "Thiết bị không khớp với phiên đã ghi nhớ.",
      };
    }

    const account = await Account.findById(payload.accountId);
    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại.",
      };
    }

    if (account.role !== "user") {
      throw {
        statusCode: 403,
        message: "Chỉ tài khoản user được đăng nhập nhanh.",
      };
    }

    await this.getActiveAccountOrThrow(account);

    const rememberedSession = (account.rememberedLogins || []).find(
      (item) =>
        item.sessionId === payload.sessionId && item.deviceId === deviceId,
    );

    if (!rememberedSession) {
      throw {
        statusCode: 401,
        message: "Phiên ghi nhớ đã bị thu hồi hoặc không tồn tại.",
      };
    }

    const user = await User.findById(payload.userId);
    if (!user || user.accountId.toString() !== account._id.toString()) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy hồ sơ user phù hợp.",
      };
    }

    const session = await this.createCurrentSession(
      account._id,
      deviceId,
      rememberedSession.deviceName || "remembered-login",
    );
    await this.revokeRememberedLoginsExceptDevice(account._id, deviceId);

    const token = this.generateToken(
      account._id,
      user._id,
      session.sessionId,
      deviceId,
    );

    await Account.updateOne(
      {
        _id: account._id,
        "rememberedLogins.sessionId": payload.sessionId,
        "rememberedLogins.deviceId": deviceId,
      },
      {
        $set: {
          "rememberedLogins.$.lastUsedAt": new Date(),
        },
      },
    );

    return {
      token,
      user,
      role: account.role,
    };
  }

  async revokeRememberedAccount({ rememberToken, deviceId }) {
    if (!rememberToken || !deviceId) {
      throw {
        statusCode: 400,
        message: "Thiếu rememberToken hoặc deviceId.",
      };
    }

    const payload = this.verifyRememberToken(rememberToken);

    if (payload.type !== "remember_login" || payload.role !== "user") {
      throw {
        statusCode: 403,
        message: "Token ghi nhớ không hợp lệ cho thao tác thu hồi.",
      };
    }

    if (payload.deviceId !== deviceId) {
      throw {
        statusCode: 403,
        message: "Thiết bị không khớp với phiên đã ghi nhớ.",
      };
    }

    const result = await Account.updateOne(
      { _id: payload.accountId, role: "user" },
      {
        $pull: {
          rememberedLogins: {
            sessionId: payload.sessionId,
            deviceId,
          },
        },
      },
    );

    return {
      revoked: result.modifiedCount > 0,
      message:
        result.modifiedCount > 0
          ? "Đã thu hồi tài khoản đã ghi nhớ."
          : "Phiên ghi nhớ đã được thu hồi trước đó.",
    };
  }

  async getRememberedAccountInfo({ rememberToken, deviceId }) {
    if (!rememberToken || !deviceId) {
      throw {
        statusCode: 400,
        message: "Thiếu rememberToken hoặc deviceId.",
      };
    }

    const payload = this.verifyRememberToken(rememberToken);

    if (payload.type !== "remember_login" || payload.role !== "user") {
      throw {
        statusCode: 403,
        message: "Token ghi nhớ không hợp lệ cho luồng này.",
      };
    }

    if (payload.deviceId !== deviceId) {
      throw {
        statusCode: 403,
        message: "Thiết bị không khớp với phiên đã ghi nhớ.",
      };
    }

    const account = await Account.findById(payload.accountId).select(
      "email role rememberedLogins",
    );

    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại.",
      };
    }

    if (account.role !== "user") {
      throw {
        statusCode: 403,
        message: "Chỉ tài khoản user được hỗ trợ luồng này.",
      };
    }

    const rememberedSession = (account.rememberedLogins || []).find(
      (item) =>
        item.sessionId === payload.sessionId && item.deviceId === deviceId,
    );

    if (!rememberedSession) {
      throw {
        statusCode: 401,
        message: "Phiên ghi nhớ đã bị thu hồi hoặc không tồn tại.",
      };
    }

    const user = await User.findById(payload.userId).select(
      "displayName avatar accountId",
    );

    if (!user || user.accountId.toString() !== account._id.toString()) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy hồ sơ user phù hợp.",
      };
    }

    const avatarViewUrl = await this.buildAvatarViewUrl(user.avatar);

    return {
      userId: user._id,
      displayName: user.displayName,
      avatar: user.avatar,
      avatarViewUrl,
      email: account.email,
      deviceId,
      sessionId: payload.sessionId,
    };
  }

  async getMe(userId) {
    const user = await User.findById(userId).populate(
      "accountId",
      "email role isPremium premiumExpiryDate",
    );
    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy user",
      };
    }
    return user;
  }

  async changePassword(accountId, { currentPassword, newPassword, confirmPassword }, clientOrigin) {
    // 1. Validation
    if (!currentPassword) {
      throw {
        statusCode: 400,
        message: "Mật khẩu hiện tại là bắt buộc.",
      };
    }
    if (!newPassword || newPassword.length < 6) {
      throw {
        statusCode: 400,
        message: "Mật khẩu mới phải có ít nhất 6 ký tự.",
      };
    }
    if (!confirmPassword) {
      throw {
        statusCode: 400,
        message: "Xác nhận mật khẩu mới là bắt buộc.",
      };
    }
    if (newPassword !== confirmPassword) {
      throw {
        statusCode: 400,
        message: "Mật khẩu xác nhận không khớp.",
      };
    }
    if (newPassword === currentPassword) {
      throw {
        statusCode: 400,
        message: "Mật khẩu mới phải khác mật khẩu hiện tại.",
      };
    }

    // 2. Fetch account & verify currentPassword
    const account = await Account.findById(accountId);
    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại.",
      };
    }

    const isMatch = await account.comparePassword(currentPassword);
    if (!isMatch) {
      throw {
        statusCode: 403,
        message: "Mật khẩu hiện tại không chính xác.",
      };
    }

    // 3. Hash new password
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;
    const salt = await bcrypt.genSalt(rounds);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // 4. Update account and invalidate sessions
    await Account.updateOne(
      { _id: accountId },
      {
        $set: {
          password: hashedPassword,
          passwordChangedAt: new Date(),
          currentSession: {
            sessionId: null,
            deviceId: null,
            deviceName: "",
            loggedInAt: null,
          },
          rememberedLogins: [],
        },
      }
    );

    // 5. Send notification email asynchronously
    // Resolve origin
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [];
    const frontendOrigin =
      clientOrigin && allowedOrigins.includes(clientOrigin.replace(/\/+$/, ""))
        ? clientOrigin.replace(/\/+$/, "")
        : "https://dev.chatmenow.cloud";

    // Get user displayName
    let displayName = "Người dùng";
    try {
      const user = await User.findOne({ accountId });
      if (user && user.displayName) {
        displayName = user.displayName;
      }
    } catch (err) {
      console.error("[Auth] Failed to find user for display name:", err.message);
    }

    // Send email without waiting / blocking the response (fire and forget with try/catch)
    emailService.sendPasswordChangedEmail(account.email, displayName, frontendOrigin).catch((err) => {
      console.error("[Email] Failed to send password changed email:", err.message);
    });
  }

  // ─── PASSWORD RESET ────────────────────────────────────────────────

  /**
   * Check in-memory rate limit for forgot-password requests.
   * Allows PASSWORD_RESET_MAX_REQUESTS per email within PASSWORD_RESET_WINDOW_MS.
   */
  checkForgotPasswordRateLimit(email) {
    const key = `pwd-reset:${email}`;
    const now = Date.now();
    const entry = passwordResetRateLimitStore.get(key);

    if (!entry || now - entry.windowStart >= PASSWORD_RESET_WINDOW_MS) {
      passwordResetRateLimitStore.set(key, { windowStart: now, count: 1 });
      return;
    }

    entry.count += 1;

    if (entry.count > PASSWORD_RESET_MAX_REQUESTS) {
      throw {
        statusCode: 429,
        message: "Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau 15 phút.",
      };
    }
  }

  /**
   * Forgot password flow:
   * 1. Validate & normalize email
   * 2. Rate limit per email
   * 3. Find account — if not found, return silently (no information leakage)
   * 4. Generate secure random token, store SHA-256 hash + 15-min expiry
   * 5. Send password reset email
   *
   * @param {string} email
   */
  async forgotPassword(email, clientOrigin) {
    if (!email) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập địa chỉ email.",
      };
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit per email — throws 429 if exceeded
    this.checkForgotPasswordRateLimit(normalizedEmail);

    const account = await Account.findOne({ email: normalizedEmail });

    // If account doesn't exist, return silently to prevent email enumeration
    if (!account) {
      return;
    }

    // Generate a cryptographically secure random token
    const rawToken = crypto.randomBytes(32).toString("hex");

    // Store only the SHA-256 hash of the token in the database
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    account.passwordResetToken = hashedToken;
    account.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Use updateOne to avoid triggering the password hash pre-save hook
    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          passwordResetToken: hashedToken,
          passwordResetExpires: account.passwordResetExpires,
        },
      },
    );

    // Dynamic resolution of frontend URL based on ALLOWED_ORIGINS
    const defaultMobileOrigins = [
      "http://localhost",
      "https://localhost",
      "capacitor://localhost",
    ];
    const envAllowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : [];
    const allowedOrigins = new Set([...defaultMobileOrigins, ...envAllowedOrigins]);

    let baseUrl = "";
    if (clientOrigin) {
      const cleanOrigin = clientOrigin.replace(/\/+$/, "").trim();
      if (allowedOrigins.has(cleanOrigin)) {
        baseUrl = cleanOrigin;
      }
    }

    if (!baseUrl) {
      const webOrigins = envAllowedOrigins.filter(
        (o) => o.startsWith("http://") || o.startsWith("https://")
      );
      baseUrl = webOrigins[0] || "http://localhost:3000";
    }

    const resetUrl = `${baseUrl.replace(/\/+$/, "")}/reset-password?token=${rawToken}`;

    // Send email — errors here are caught by the controller
    await emailService.sendPasswordResetEmail(normalizedEmail, resetUrl);
  }

  /**
   * Reset password flow:
   * 1. Validate inputs (token, password, confirmPassword)
   * 2. Hash incoming token with SHA-256 and look up account
   * 3. Verify token hasn't expired
   * 4. Hash new password with bcrypt
   * 5. Update account, clear reset token fields, set passwordChangedAt
   * 6. Invalidate all sessions (currentSession + rememberedLogins)
   *
   * @param {Object} params
   * @param {string} params.token           - Raw reset token from the email link
   * @param {string} params.password        - New password
   * @param {string} params.confirmPassword - Password confirmation
   */
  async resetPassword({ token, password, confirmPassword }) {
    // ── Input validation ──
    if (!token) {
      throw {
        statusCode: 400,
        message: "Thiếu mã đặt lại mật khẩu.",
      };
    }

    if (!password || password.length < 6) {
      throw {
        statusCode: 400,
        message: "Mật khẩu mới phải có ít nhất 6 ký tự.",
      };
    }

    if (password !== confirmPassword) {
      throw {
        statusCode: 400,
        message: "Mật khẩu xác nhận không khớp.",
      };
    }

    // ── Token verification ──
    // Hash the incoming raw token to compare with stored hash
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const account = await Account.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!account) {
      throw {
        statusCode: 400,
        message: "Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
      };
    }

    // ── Update password ──
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;
    const salt = await bcrypt.genSalt(rounds);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Use updateOne to set the already-hashed password directly,
    // bypassing the pre-save hook which would double-hash it
    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          password: hashedPassword,
          passwordChangedAt: new Date(),
          // Clear reset token fields (single-use token)
          passwordResetToken: null,
          passwordResetExpires: null,
          // Invalidate all sessions — force re-login on all devices
          currentSession: {
            sessionId: null,
            deviceId: null,
            deviceName: "",
            loggedInAt: null,
          },
          rememberedLogins: [],
        },
      },
    );
  }

  async sendSelfLockOtp(accountId) {
    const account = await Account.findById(accountId).select(
      "email accountStatus isActive",
    );

    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại.",
      };
    }

    if (account.accountStatus !== "active" || account.isActive === false) {
      throw {
        statusCode: 400,
        message: "Chỉ tài khoản đang hoạt động mới có thể gửi OTP tạm khóa.",
      };
    }

    return await otpService.sendOtp(
      account.email,
      otpService.PURPOSES.ACCOUNT_LOCK,
    );
  }

  async verifySelfLockOtp(accountId, { otp }) {
    const account = await Account.findById(accountId).select(
      "email accountStatus isActive",
    );

    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại.",
      };
    }

    if (account.accountStatus !== "active" || account.isActive === false) {
      throw {
        statusCode: 400,
        message: "Tài khoản không ở trạng thái hoạt động để tạm khóa.",
      };
    }

    otpService.verifyOtp(
      account.email,
      otp,
      otpService.PURPOSES.ACCOUNT_LOCK,
    );
    otpService.clearOtp(account.email, otpService.PURPOSES.ACCOUNT_LOCK);

    const verifySession = this.createSelfLockVerifySession(account._id);

    return {
      message: "Xác thực OTP thành công. Bạn có 5 phút để hoàn tất tạm khóa.",
      lockVerificationToken: verifySession.token,
      expiresIn: verifySession.expiresIn,
      expiresAt: verifySession.expiresAt,
      verificationExpiresAt: verifySession.expiresAt,
    };
  }

  async confirmSelfLock(accountId, { reason, otherReason, lockVerificationToken }) {
    const account = await Account.findById(accountId).select(
      "email accountStatus isActive",
    );

    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại.",
      };
    }

    if (account.accountStatus !== "active" || account.isActive === false) {
      throw {
        statusCode: 400,
        message: "Tài khoản không ở trạng thái hoạt động để tạm khóa.",
      };
    }

    this.consumeSelfLockVerifySession(account._id, lockVerificationToken);

    const statusReason = this.getSelfLockReason(reason, otherReason);

    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          accountStatus: "locked",
          isActive: false,
          suspendedUntil: null,
          statusReason,
          statusUpdatedAt: new Date(),
          currentSession: {
            sessionId: null,
            deviceId: null,
            deviceName: "",
            loggedInAt: null,
          },
          rememberedLogins: [],
        },
      },
    );

    return {
      locked: true,
      statusReason,
      message: "Đã tạm khóa tài khoản vô thời hạn. Chỉ mở lại khi bạn tự xác thực OTP mở khóa.",
      lockDuration: "indefinite",
      lockedUntil: null,
    };
  }

  async sendUnlockOtp({ email }) {
    if (!email) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập địa chỉ email.",
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const account = await Account.findOne({ email: normalizedEmail }).select(
      "accountStatus isActive",
    );

    if (!account) {
      throw {
        statusCode: 404,
        message: "Email chưa được đăng ký tài khoản.",
      };
    }

    if (account.accountStatus !== "locked" && account.isActive !== false) {
      throw {
        statusCode: 400,
        message: "Tài khoản này hiện không ở trạng thái tạm khóa.",
      };
    }

    return await otpService.sendOtp(
      normalizedEmail,
      otpService.PURPOSES.ACCOUNT_UNLOCK,
    );
  }

  async confirmUnlockByOtp({ email, otp }) {
    if (!email) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập địa chỉ email.",
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const account = await Account.findOne({ email: normalizedEmail }).select(
      "accountStatus isActive",
    );

    if (!account) {
      throw {
        statusCode: 404,
        message: "Email chưa được đăng ký tài khoản.",
      };
    }

    if (account.accountStatus !== "locked" && account.isActive !== false) {
      throw {
        statusCode: 400,
        message: "Tài khoản này hiện không ở trạng thái tạm khóa.",
      };
    }

    otpService.verifyOtp(
      normalizedEmail,
      otp,
      otpService.PURPOSES.ACCOUNT_UNLOCK,
    );

    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          accountStatus: "active",
          isActive: true,
          suspendedUntil: null,
          statusReason: "",
          statusUpdatedAt: new Date(),
        },
      },
    );

    otpService.clearOtp(
      normalizedEmail,
      otpService.PURPOSES.ACCOUNT_UNLOCK,
    );

    return {
      unlocked: true,
      message: "Đã mở khóa tài khoản thành công. Bạn có thể đăng nhập lại.",
    };
  }
}

module.exports = new AuthService();

