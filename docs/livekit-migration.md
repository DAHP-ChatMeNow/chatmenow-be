# LiveKit Migration Guide (WebRTC P2P -> SFU)

## 1) Backend API mới

`GET /api/livekit-token?roomId=<room-id>`

Headers:
- `x-api-key: <API_KEY>`
- `Authorization: Bearer <jwt>`

Response:

```json
{
  "token": "<livekit-jwt>",
  "livekitUrl": "ws://livekit:7880",
  "roomId": "conversation_123",
  "identity": "userId",
  "participantName": "Display Name",
  "expiresIn": 3600
}
```

## 2) Socket event giữ lại cho call state

Client emit:
- `call-user`: `{ toUserId, roomId, conversationId, callType }`
- `accept-call`: `{ toUserId, roomId, conversationId, callType }`
- `reject-call`: `{ toUserId, roomId, conversationId, callType, reason }`

Server emit:
- `incoming-call`
- `call-accepted`
- `call-rejected`
- `call-error`

Lưu ý: Không còn offer/answer/ICE signaling.

## 3) Frontend service mẫu (Next.js + React)

Tạo file `services/livekitCallService.ts` trong frontend:

```ts
import { Room, RoomEvent, Track } from "livekit-client";

type StartCallInput = {
  roomId: string;
  authToken: string; // JWT của app
  apiBaseUrl: string; // ví dụ https://api.chatmenow.cloud
  apiKey: string;
  onRemoteTrack?: (mediaEl: HTMLMediaElement) => void;
};

export class LivekitCallService {
  private room: Room | null = null;

  async startCall(input: StartCallInput) {
    const isEnabled = process.env.NEXT_PUBLIC_ENABLE_CALL === "true";
    if (!isEnabled) {
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

    const tokenData: { token: string; livekitUrl: string } = await tokenRes.json();

    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    this.room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
        const el = track.attach();
        input.onRemoteTrack?.(el);
      }
    });

    await this.room.connect(
      process.env.NEXT_PUBLIC_LIVEKIT_URL || tokenData.livekitUrl,
      tokenData.token,
    );

    await this.room.localParticipant.enableCameraAndMicrophone();
  }

  async leaveCall() {
    if (!this.room) return;
    this.room.disconnect();
    this.room = null;
  }
}
```

## 4) Migration checklist từ code cũ

1. Xóa toàn bộ logic WebRTC P2P:
   - `RTCPeerConnection`
   - `createOffer/createAnswer`
   - `setLocalDescription/setRemoteDescription`
   - `onicecandidate` và ICE queue/timing retry
2. Xóa socket events cũ liên quan signaling:
   - `webrtc-offer`, `webrtc-answer`, `ice-candidate` (nếu đang dùng)
3. Giữ lại socket business event:
   - `call-user`, `accept-call`, `reject-call`
4. Khi user bấm gọi:
   - emit `call-user` (kèm `roomId`)
   - user nhận bấm accept -> emit `accept-call`
   - cả 2 bên gọi API `/api/livekit-token`
   - connect LiveKit room + publish camera/mic
5. Khi reject:
   - emit `reject-call`
   - không connect LiveKit
6. Môi trường local:
   - `NEXT_PUBLIC_ENABLE_CALL=false`
   - ẩn toàn bộ UI call button hoặc disable click.

## 5) Production notes (AWS)

- Mở security group cho LiveKit:
  - TCP `7880`, TCP `7881`
  - UDP `50000-50100`
- `LIVEKIT_URL` cho frontend nên dùng `wss://<domain>/livekit`
- Nếu dùng Nginx reverse proxy `/livekit`, bật websocket upgrade và timeout dài.
