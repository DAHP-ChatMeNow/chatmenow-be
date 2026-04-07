const crypto = require("crypto");

exports.apiKeyMiddleware = (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({ message: "Thiếu API key" });
  }

  const expectedKey = process.env.API_KEY;
  const isValid =
    apiKey.length === expectedKey.length &&
    crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(expectedKey));

  if (!isValid) {
    return res.status(403).json({ message: "API key không hợp lệ" });
  }

  next();
};
