const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin.controller");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");

router.get("/stats", verifyToken, requireAdmin, adminController.getStats);

module.exports = router;
