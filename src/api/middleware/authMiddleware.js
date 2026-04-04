const jwt = require("jsonwebtoken");
const Account = require("../models/account.model");
const { USER_ROLES } = require("../../constants");

exports.authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Chưa đăng nhập!" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const account = await Account.findById(decoded.accountId).select(
      "accountStatus suspendedUntil isActive",
    );

    if (!account) {
      return res.status(401).json({ message: "Tài khoản không tồn tại" });
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
      return res.status(403).json({ message: "Tài khoản đã bị khóa" });
    }

    if (account.accountStatus === "suspended") {
      return res.status(403).json({ message: "Tài khoản đang bị đình chỉ" });
    }

    req.user = {
      accountId: decoded.accountId,
      userId: decoded.userId,
    };

    return next();
  } catch (error) {
    return res
      .status(403)
      .json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }
};

exports.verifyToken = exports.authMiddleware;

exports.requireAdmin = async (req, res, next) => {
  try {
    const account = await Account.findById(req.user.accountId).select(
      "role accountStatus suspendedUntil isActive",
    );

    if (!account) {
      return res.status(401).json({ message: "Tài khoản không tồn tại" });
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

    if (account.accountStatus !== "active" || account.isActive === false) {
      return res.status(403).json({
        message:
          account.accountStatus === "locked"
            ? "Tài khoản đã bị khóa"
            : "Tài khoản đang bị đình chỉ",
      });
    }

    if (account.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({ message: "Bạn không có quyền truy cập" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server" });
  }
};
