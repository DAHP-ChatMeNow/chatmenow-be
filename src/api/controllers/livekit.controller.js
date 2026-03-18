const livekitService = require("../service/livekit.service");

const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

exports.getLivekitToken = async (req, res) => {
  try {
    const roomId = (req.query.roomId || "").trim();
    const participantName = (req.query.participantName || "").trim();

    if (!roomId) {
      return res.status(400).json({ message: "Thiếu roomId" });
    }

    if (!ROOM_ID_REGEX.test(roomId)) {
      return res.status(400).json({
        message:
          "roomId không hợp lệ (chỉ cho phép chữ, số, _, - và tối đa 128 ký tự)",
      });
    }

    if (participantName.length > 120) {
      return res.status(400).json({
        message: "participantName quá dài (tối đa 120 ký tự)",
      });
    }

    const result = await livekitService.generateToken({
      roomId,
      userId: req.user.userId,
      participantName,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Không thể tạo LiveKit token",
      error: error.message,
    });
  }
};
