const reelService = require("../service/reel.service");

/**
 * Unified error handler – keeps controllers thin.
 */
const handleError = (res, error) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error("[ReelController]", error);
  return res.status(500).json({ success: false, message: error.message || "Lỗi server" });
};

// POST /reels
exports.createReel = async (req, res) => {
  try {
    const userId = req.user.userId;
    const file   = req.file; // single video file (multerReelVideo)
    const reel   = await reelService.createReel(userId, req.body, file);
    return res.status(201).json({ success: true, data: reel });
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /reels/:id
exports.deleteReel = async (req, res) => {
  try {
    const result = await reelService.deleteReel(req.user.userId, req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /reels/:id/like
exports.likeReel = async (req, res) => {
  try {
    const result = await reelService.likeReel(req.user.userId, req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /reels/:id/like
exports.unlikeReel = async (req, res) => {
  try {
    const result = await reelService.unlikeReel(req.user.userId, req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /reels/:id/view
exports.addView = async (req, res) => {
  try {
    const watchSeconds = req.body.watchSeconds ? parseFloat(req.body.watchSeconds) : 0;
    const result = await reelService.addView(req.params.id, watchSeconds);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /reels/feed?cursor=
exports.getReelFeed = async (req, res) => {
  try {
    const cursor = req.query.cursor || null;
    const result = await reelService.getReelFeed(cursor, req.user.userId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /reels/user/:userId
exports.getUserReels = async (req, res) => {
  try {
    const reels = await reelService.getUserReels(req.params.userId, req.user.userId);
    return res.status(200).json({ success: true, data: reels });
  } catch (error) {
    return handleError(res, error);
  }
};
