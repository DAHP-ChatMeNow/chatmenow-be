const crypto = require("crypto");
const emailService = require("./email.service");

// In-memory OTP store (sử dụng Map với auto-expiry)
// Trong production nên dùng Redis, nhưng vì project có thể chưa setup Redis thì dùng in-memory
const otpStore = new Map();

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 phút
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 giây giữa mỗi lần gửi
const MAX_VERIFY_ATTEMPTS = 5;

class OtpService {
  generateOtp() {
    // Tạo mã OTP 6 chữ số ngẫu nhiên
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp;
  }

  getOtpKey(email) {
    return `otp:${email.toLowerCase().trim()}`;
  }

  async sendOtp(email) {
    if (!email) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập địa chỉ email.",
      };
    }

    const key = this.getOtpKey(email);
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
    await emailService.sendOtpEmail(email, otpCode);

    return {
      message: "Mã OTP đã được gửi đến email của bạn.",
      expiresIn: OTP_EXPIRY_MS / 1000,
    };
  }

  verifyOtp(email, otpCode) {
    if (!email || !otpCode) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập email và mã OTP.",
      };
    }

    const key = this.getOtpKey(email);
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

  isOtpVerified(email) {
    const key = this.getOtpKey(email);
    const otpData = otpStore.get(key);
    return otpData?.verified === true;
  }

  clearOtp(email) {
    const key = this.getOtpKey(email);
    otpStore.delete(key);
  }
}

module.exports = new OtpService();
