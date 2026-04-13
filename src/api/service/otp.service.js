const crypto = require("crypto");
const emailService = require("./email.service");

// In-memory OTP store (sử dụng Map với auto-expiry)
// Trong production nên dùng Redis, nhưng vì project có thể chưa setup Redis thì dùng in-memory
const otpStore = new Map();

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 phút
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 giây giữa mỗi lần gửi
const MAX_VERIFY_ATTEMPTS = 5;
const OTP_PURPOSES = {
  REGISTER: "register",
  ACCOUNT_LOCK: "account_lock",
  ACCOUNT_UNLOCK: "account_unlock",
};

class OtpService {
  constructor() {
    this.PURPOSES = OTP_PURPOSES;
  }

  generateOtp() {
    // Tạo mã OTP 6 chữ số ngẫu nhiên
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp;
  }

  normalizePurpose(purpose) {
    return (purpose || OTP_PURPOSES.REGISTER).toLowerCase().trim();
  }

  getOtpKey(email, purpose = OTP_PURPOSES.REGISTER) {
    const normalizedPurpose = this.normalizePurpose(purpose);
    return `otp:${normalizedPurpose}:${email.toLowerCase().trim()}`;
  }

  buildOtpContext(purpose) {
    const normalizedPurpose = this.normalizePurpose(purpose);

    if (normalizedPurpose === OTP_PURPOSES.ACCOUNT_LOCK) {
      return {
        title: "Xác thực tạm khóa tài khoản",
        description:
          "Bạn đang yêu cầu tạm khóa tài khoản Chat Me Now. Vui lòng nhập mã OTP để xác nhận thao tác này.",
        fallback:
          "Nếu bạn không thực hiện yêu cầu tạm khóa tài khoản, vui lòng đổi mật khẩu ngay.",
      };
    }

    if (normalizedPurpose === OTP_PURPOSES.ACCOUNT_UNLOCK) {
      return {
        title: "Xác thực mở khóa tài khoản",
        description:
          "Bạn đang yêu cầu mở khóa tài khoản Chat Me Now. Vui lòng nhập mã OTP để xác nhận thao tác này.",
        fallback: "Nếu bạn không yêu cầu mở khóa, vui lòng bỏ qua email này.",
      };
    }

    return {
      title: "Xác thực tài khoản",
      description:
        "Bạn đã yêu cầu đăng ký tài khoản trên Chat Me Now. Vui lòng sử dụng mã OTP bên dưới để hoàn tất xác thực.",
      fallback: "Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.",
    };
  }

  async sendOtp(email, purpose = OTP_PURPOSES.REGISTER) {
    if (!email) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập địa chỉ email.",
      };
    }

    const key = this.getOtpKey(email, purpose);
    const existing = otpStore.get(key);

    // Kiểm tra cooldown để tránh spam
    if (existing && existing.lastSentAt) {
      const elapsed = Date.now() - existing.lastSentAt;
      if (elapsed < OTP_RESEND_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil(
          (OTP_RESEND_COOLDOWN_MS - elapsed) / 1000,
        );
        throw {
          statusCode: 429,
          message: `Vui lòng đợi ${remainingSeconds} giây trước khi gửi lại mã OTP.`,
        };
      }
    }

    const otpCode = this.generateOtp();

    // Lưu OTP vào store
    const otpData = {
      code: otpCode,
      email: email.toLowerCase().trim(),
      purpose: this.normalizePurpose(purpose),
      createdAt: Date.now(),
      lastSentAt: Date.now(),
      attempts: 0,
      verified: false,
    };

    otpStore.set(key, otpData);

    // Tự động xóa OTP sau khi hết hạn
    setTimeout(() => {
      const current = otpStore.get(key);
      if (current && current.createdAt === otpData.createdAt) {
        otpStore.delete(key);
      }
    }, OTP_EXPIRY_MS);

    // Gửi email
    const context = this.buildOtpContext(purpose);
    await emailService.sendOtpEmail(email, otpCode, context);

    return {
      message: "Mã OTP đã được gửi đến email của bạn.",
      expiresIn: OTP_EXPIRY_MS / 1000,
    };
  }

  verifyOtp(email, otpCode, purpose = OTP_PURPOSES.REGISTER) {
    if (!email || !otpCode) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập email và mã OTP.",
      };
    }

    const key = this.getOtpKey(email, purpose);
    const otpData = otpStore.get(key);

    if (!otpData) {
      throw {
        statusCode: 400,
        message: "Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.",
      };
    }

    // Kiểm tra số lần thử
    if (otpData.attempts >= MAX_VERIFY_ATTEMPTS) {
      otpStore.delete(key);
      throw {
        statusCode: 429,
        message:
          "Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã OTP mới.",
      };
    }

    // Kiểm tra hết hạn
    if (Date.now() - otpData.createdAt > OTP_EXPIRY_MS) {
      otpStore.delete(key);
      throw {
        statusCode: 400,
        message: "Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.",
      };
    }

    // Tăng số lần thử
    otpData.attempts += 1;

    // So sánh OTP
    if (otpData.code !== otpCode.toString().trim()) {
      const remaining = MAX_VERIFY_ATTEMPTS - otpData.attempts;
      throw {
        statusCode: 400,
        message: `Mã OTP không chính xác. Bạn còn ${remaining} lần thử.`,
      };
    }

    // Đánh dấu đã xác thực
    otpData.verified = true;

    return {
      message: "Xác thực OTP thành công.",
      verified: true,
    };
  }

  isOtpVerified(email, purpose = OTP_PURPOSES.REGISTER) {
    const key = this.getOtpKey(email, purpose);
    const otpData = otpStore.get(key);
    return otpData?.verified === true;
  }

  clearOtp(email, purpose = OTP_PURPOSES.REGISTER) {
    const key = this.getOtpKey(email, purpose);
    otpStore.delete(key);
  }
}

OtpService.PURPOSES = OTP_PURPOSES;

module.exports = new OtpService();
