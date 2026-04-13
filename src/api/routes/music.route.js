const express = require("express");
const router = express.Router();

const musicController = require("../controllers/music.controller");
const { verifyToken } = require("../middleware/authMiddleware");

router.get("/search", verifyToken, musicController.search);
router.get("/popular", verifyToken, musicController.getPopular);

module.exports = router;
