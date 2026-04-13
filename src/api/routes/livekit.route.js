const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const livekitController = require("../controllers/livekit.controller");

router.get("/livekit-token", verifyToken, livekitController.getLivekitToken);

module.exports = router;
