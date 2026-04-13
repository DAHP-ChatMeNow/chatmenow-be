const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const videoCallController = require("../controllers/video-call.controller");

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /api/video-calls/initiate
 * Initiate a new video call
 */
router.post("/initiate", videoCallController.initiateCall);

/**
 * POST /api/video-calls/initiate-group
 * Initiate a new group video call
 */
router.post("/initiate-group", videoCallController.initiateGroupCall);

/**
 * POST /api/video-calls/:callId/accept
 * Accept incoming video call
 */
router.post("/:callId/accept", videoCallController.acceptCall);

/**
 * POST /api/video-calls/:callId/reject
 * Reject incoming video call
 */
router.post("/:callId/reject", videoCallController.rejectCall);

/**
 * POST /api/video-calls/:callId/end
 * End an ongoing video call
 */
router.post("/:callId/end", videoCallController.endCall);

/**
 * GET /api/video-calls/history
 * Get call history for current user
 */
router.get("/history", videoCallController.getCallHistory);

/**
 * GET /api/video-calls/active
 * Get active ongoing call
 */
router.get("/active", videoCallController.getActiveCall);

/**
 * GET /api/video-calls/stats
 * Get call statistics
 */
router.get("/stats", videoCallController.getCallStats);

module.exports = router;
