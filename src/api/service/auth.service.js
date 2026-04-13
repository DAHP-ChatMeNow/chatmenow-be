const Account = require("../models/account.model");
const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { getSignedUrlFromS3 } = require("../middleware/storage");
const { generateDefaultAvatar } = require("../../utils/avatar.helper");
const otpService = require("./otp.service");
const SELF_LOCK_VERIFY_SESSION_MS = 5 * 60 * 1000;
const selfLockVerifySessionStore = new Map();

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
      "email role isPremium",
    );
    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy user",
      };
    }
    return user;
  }

  async changePassword(userId, { oldPassword, newPassword }) {
    throw {
      statusCode: 200,
      message: "Tính năng đang phát triển",
    };
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
