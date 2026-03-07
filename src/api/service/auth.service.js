const Account = require("../models/account.model");
const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const { generateDefaultAvatar } = require("../../utils/avatar.helper");

class AuthService {
  generateToken(accountId, userId) {
    return jwt.sign({ accountId, userId }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });
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

    const token = this.generateToken(newAccount._id, newUser._id);

    return {
      token,
      user: newUser,
    };
  }

  async login({ email, password }) {
    const account = await Account.findOne({ email });
    if (!account) {
      throw {
        statusCode: 401,
        message: "Email hoặc mật khẩu không đúng.",
      };
    }

    const isMatch = await account.comparePassword(password);
    if (!isMatch) {
      throw {
        statusCode: 401,
        message: "Email hoặc mật khẩu không đúng.",
      };
    }

    const user = await User.findOne({ accountId: account._id });
    const token = this.generateToken(account._id, user._id);

    return {
      token,
      user,
      role: account.role,
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
}

module.exports = new AuthService();
