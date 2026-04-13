const express = require("express");
const router = express.Router();

const authRoute = require("./auth.route");
const userRoute = require("./user.route");
const postRoute = require("./post.route");
const chatRoute = require("./chat.route");
const notiRoute = require("./notification.route");
const uploadRoute = require("./upload.route");
const livekitRoute = require("./livekit.route");
const storyRoute = require("./story.route");
const adminRoute = require("./admin.route");
const reelRoute = require("./reel.route");
const musicRoute = require("./music.route");

router.use("/auth", authRoute);
router.use("/users", userRoute);
router.use("/posts", postRoute);
router.use("/chat", chatRoute);
router.use("/notifications", notiRoute);
router.use("/upload", uploadRoute);
router.use("/stories", storyRoute);
router.use("/admin", adminRoute);
router.use("/reels", reelRoute);
router.use("/music", musicRoute);
router.use("/", livekitRoute);

module.exports = router;
