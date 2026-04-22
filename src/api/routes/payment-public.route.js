const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");

router.get("/vnpay-return", userController.handleVNPayReturn);
router.get("/vnpay-ipn", userController.handleVNPayIpn);

module.exports = router;
