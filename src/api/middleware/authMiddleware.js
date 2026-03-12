const jwt = require("jsonwebtoken");
const Account = require("../models/account.model");
const { USER_ROLES } = require("../../constants");

exports.authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Chưa đăng nhập!" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      accountId: decoded.accountId,
      userId: decoded.userId,
    };

    next();
  } catch (error) {
    return res
      .status(403)
      .json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }
};

exports.verifyToken = exports.authMiddleware;

exports.requireAdmin = async (req, res, next) => {
  try {
    const account = await Account.findById(req.user.accountId).select("role");
    if (!account || account.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({ message: "Bạn không có quyền truy cập" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server" });
  }
};
