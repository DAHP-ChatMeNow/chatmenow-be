const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.transporter = null;
  }

  getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });
    }
    return this.transporter;
  }

  async sendOtpEmail(toEmail, otpCode) {
    const transporter = this.getTransporter();

    const mailOptions = {
      from: `"Chat Me Now" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: "Mã xác thực OTP - Chat Me Now",
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #7c3aed 100%); padding: 40px 32px; text-align: center;">
            <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 16px 0 4px;">Chat Me Now</h1>
            <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 0;">Xác thực tài khoản</p>
          </div>
          <div style="padding: 40px 32px;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">Xin chào,</p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6; margin: 0 0 28px;">
              Bạn đã yêu cầu đăng ký tài khoản trên <strong>Chat Me Now</strong>. Vui lòng sử dụng mã OTP bên dưới để hoàn tất xác thực:
            </p>
            <div style="background: linear-gradient(135deg, #eff6ff 0%, #f0f4ff 100%); border: 2px dashed #93c5fd; border-radius: 12px; padding: 28px; text-align: center; margin: 0 0 28px;">
              <p style="color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 12px; font-weight: 600;">Mã xác thực của bạn</p>
              <div style="font-size: 40px; font-weight: 800; color: #1d4ed8; letter-spacing: 12px; font-family: 'Courier New', monospace;">${otpCode}</div>
            </div>
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; padding: 14px 16px; margin: 0 0 28px;">
              <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
                ⏱️ Mã OTP có hiệu lực trong <strong>5 phút</strong>. Vui lòng không chia sẻ mã này với bất kỳ ai.
              </p>
            </div>
            <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 0;">
              Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.
            </p>
          </div>
          <div style="background: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} Chat Me Now. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[Email] OTP sent to ${toEmail}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`[Email] Failed to send OTP to ${toEmail}:`, error.message);
      throw {
        statusCode: 500,
        message: "Không thể gửi email OTP. Vui lòng thử lại sau.",
      };
    }
  }
}

module.exports = new EmailService();
