const { AccessToken } = require("livekit-server-sdk");

class LivekitService {
  getConfig() {
    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      throw new Error(
        "Thiếu cấu hình LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)",
      );
    }

    return { livekitUrl, apiKey, apiSecret };
  }

  async generateToken({ roomId, userId, participantName }) {
    const { livekitUrl, apiKey, apiSecret } = this.getConfig();

    const identity = String(userId);
    const resolvedParticipantName = participantName || identity;

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: resolvedParticipantName,
      ttl: "1h",
      metadata: JSON.stringify({ userId: identity }),
    });

    token.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    return {
      token: await token.toJwt(),
      livekitUrl,
      roomId,
      identity,
      participantName: resolvedParticipantName,
      expiresIn: 3600,
    };
  }
}

module.exports = new LivekitService();
