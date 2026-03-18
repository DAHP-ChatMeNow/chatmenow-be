import { Room, RoomEvent, Track } from "livekit-client";

type StartCallInput = {
  roomId: string;
  authToken: string;
  apiBaseUrl: string;
  apiKey: string;
  onRemoteTrack?: (mediaEl: HTMLMediaElement) => void;
};

export class LivekitCallService {
  private room: Room | null = null;

  async startCall(input: StartCallInput) {
    const isCallEnabled = process.env.NEXT_PUBLIC_ENABLE_CALL === "true";
    if (!isCallEnabled) {
      throw new Error("Call feature đang tắt ở môi trường hiện tại");
    }

    const tokenRes = await fetch(
      `${input.apiBaseUrl}/api/livekit-token?roomId=${encodeURIComponent(input.roomId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.authToken}`,
          "x-api-key": input.apiKey,
        },
      },
    );

    if (!tokenRes.ok) {
      throw new Error("Không lấy được LiveKit token");
    }

    const tokenData: { token: string; livekitUrl: string } =
      await tokenRes.json();

    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    this.room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
        const mediaEl = track.attach();
        input.onRemoteTrack?.(mediaEl);
      }
    });

    await this.room.connect(
      process.env.NEXT_PUBLIC_LIVEKIT_URL || tokenData.livekitUrl,
      tokenData.token,
    );

    await this.room.localParticipant.enableCameraAndMicrophone();
  }

  leaveCall() {
    this.room?.disconnect();
    this.room = null;
  }
}
