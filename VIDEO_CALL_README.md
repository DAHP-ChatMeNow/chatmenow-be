# 📹 Video Call Feature - Quick Start

## Architecture

```
Client A ─→ Socket.IO Signaling ←─ Client B
   │              Server              │
   └─────── WebRTC P2P Connection ────┘
           (Direct Video/Audio)
```

## 🔧 Recent Updates (v1.1)

### Bug Fixes & Improvements

#### 1. ✅ Import Missing Constants

- **File:** `src/api/models/video-call.model.js`
- **Change:** Added import for `CALL_TYPE` and `VIDEO_CALL_STATUS`

```javascript
const {
  CALL_TYPE,
  VIDEO_CALL_STATUS,
} = require("../../constants/video-call.constants");
```

- **Issue:** `ReferenceError: CALL_TYPE is not defined`

#### 2. ✅ Add Video Call Notification Type

- **File:** `src/constants/notification.constants.js`
- **Change:** Added `VIDEO_CALL: "video_call"` to `NOTIFICATION_TYPES`

```javascript
const NOTIFICATION_TYPES = {
  MESSAGE: "message",
  FRIEND_REQUEST: "friend_request",
  POST_LIKE: "post_like",
  POST_COMMENT: "post_comment",
  SYSTEM: "system",
  GROUP_INVITE: "group_invite",
  VIDEO_CALL: "video_call", // ← NEW
};
```

- **File:** `src/api/models/notification.model.js`
- **Change:** Updated enum to use constants instead of hardcoded values

```javascript
type: {
  type: String,
  enum: Object.values(NOTIFICATION_TYPES),  // ← Updated
  required: true,
},
```

- **Issue:** `Notification validation failed: type: 'video_call' is not a valid enum`

#### 3. ✅ Fix Call Timer Not Running

- **File:** `src/api/service/video-call.service.js`
- **Changes:**
  - `startTime` → `startedAt` (when accept call)
  - `endTime` → `endedAt` (when end/reject call)
  - Duration calculation now uses correct field names

```javascript
// Before (WRONG)
status: VIDEO_CALL_STATUS.ACCEPTED,
startTime: new Date(),  // ❌ Not in schema

// After (CORRECT)
status: VIDEO_CALL_STATUS.ACCEPTED,
startedAt: new Date(),  // ✅ Matches schema
```

- **Impact:** Timer now starts counting when call is accepted and duration is properly calculated

#### 4. ✅ Update Notification Model Import

- **File:** `src/api/models/notification.model.js`
- **Change:** Added import for constants to centralize enum values

```javascript
const {
  NOTIFICATION_TYPES,
} = require("../../constants/notification.constants");
```

---

## Files Created

### Backend

- `src/constants/video-call.constants.js` - Constants for call status and events
- `src/api/models/video-call.model.js` - MongoDB schema for video call records
- `src/api/service/video-call.service.js` - Business logic for video calls
- `src/api/controllers/video-call.controller.js` - API endpoint handlers
- `src/api/routes/video-call.route.js` - Route definitions
- `src/sockets/socket.handler.js` - **UPDATED** with WebRTC signaling

### Frontend Resources

- `VIDEO_CALL_CLIENT_EXAMPLE.js` - Reusable VideoCallClient class
- `VIDEO_CALL_DEMO.html` - Interactive demo page
- `VIDEO_CALL_GUIDE.md` - Complete implementation guide

## API Endpoints

| Endpoint                          | Method | Description             |
| --------------------------------- | ------ | ----------------------- |
| `/api/video-calls/initiate`       | POST   | Start a new call        |
| `/api/video-calls/:callId/accept` | POST   | Accept incoming call    |
| `/api/video-calls/:callId/reject` | POST   | Reject incoming call    |
| `/api/video-calls/:callId/end`    | POST   | End a call              |
| `/api/video-calls/active`         | GET    | Get current active call |
| `/api/video-calls/history`        | GET    | Get call history        |
| `/api/video-calls/stats`          | GET    | Get call statistics     |

## Socket Events

| Event           | Direction | Purpose                    |
| --------------- | --------- | -------------------------- |
| `initiate-call` | C→S       | Start call                 |
| `call-ringing`  | S→C       | Incoming call notification |
| `accept-call`   | C→S       | Accept call                |
| `call-accepted` | S→C       | Call accepted              |
| `call-offer`    | ↔         | WebRTC Offer               |
| `call-answer`   | ↔         | WebRTC Answer              |
| `ice-candidate` | ↔         | ICE candidates             |
| `end-call`      | C→S       | End call                   |
| `call-ended`    | S→C       | Call ended                 |

## Quick Integration (Frontend)

### 1. Import client

```html
<script src="VIDEO_CALL_CLIENT_EXAMPLE.js"></script>
<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
```

### 2. Initialize

```javascript
const socket = io("http://backend-url:5000");
const videoCallClient = new VideoCallClient(
  socket,
  userId,
  localVideoElement,
  remoteVideoElement,
);
```

### 3. Start a call

```javascript
await videoCallClient.initiateCall(receiverId, "video");
```

### 4. Handle incoming calls

```javascript
videoCallClient.onIncomingCall = (data) => {
  console.log("Call from:", data.callerName);
  // Show accept/reject UI
};
```

### 5. Accept & Reject

```javascript
videoCallClient.acceptCall(callId);
videoCallClient.rejectCall(callId, "declined");
```

### 6. End call

```javascript
videoCallClient.endCall();
```

## Testing

### Option 1: Use Demo HTML

1. Open `VIDEO_CALL_DEMO.html` in browser
2. Enter JWT token and user IDs
3. Click "Start Call"

### Option 2: Manual Testing

```bash
# Terminal 1: Frontend A
curl -X POST http://localhost:5000/api/video-calls/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN_A" \
  -d '{"receiverId": "USER_B_ID", "callType": "video"}'

# Then open 2 browser tabs for A and B to test WebRTC
```

## Signaling Flow (Step-by-step)

### 1️⃣ User A initiates call

```
A: POST /api/video-calls/initiate {receiverId: B}
   ↓
Server: Creates VideoCall record (status: initiated)
   ↓
Server: Broadcasts "call-ringing" to B via socket
```

### 2️⃣ User B receives notification

```
B: socket.on('call-ringing', data => ...)
   ↓
B: Shows incoming call UI (Accept/Reject buttons)
```

### 3️⃣ User B accepts

```
B: POST /api/video-calls/:callId/accept
   ↓
Server: Updates call status to "accepted"
   ↓
A: socket.on('call-accepted', data => ...)
```

### 4️⃣ WebRTC Handshake

```
A: Creates RTCPeerConnection
   ↓
A: Creates SDP Offer with createOffer()
   ↓
A: socket.emit('call-offer', {offer})
   ↓
Server: Forwards to B
   ↓
B: socket.on('call-offer', {offer => ...})
   ↓
B: setRemoteDescription(offer)
   ↓
B: Creates SDP Answer with createAnswer()
   ↓
B: socket.emit('call-answer', {answer})
   ↓
A: setRemoteDescription(answer)
```

### 5️⃣ ICE Candidate Exchange

```
A & B continuously emit/receive ice-candidate events
   ↓
Both call addIceCandidate() for each received candidate
   ↓
Connection established when ICE candidates connect
```

### 6️⃣ Call ends

```
A or B: POST /api/video-calls/:callId/end
   ↓
Server: Calculates duration
   ↓
Other party: socket.on('call-ended', data => ...)
```

## Database Schema

```javascript
VideoCall {
  _id: ObjectId,
  callerId: ObjectId (ref: User),      // Who initiated
  receiverId: ObjectId (ref: User),    // Who received
  status: String,                      // initiated|accepted|rejected|ended|missed
  startedAt: Date,                     // When call started (set on accept)
  endedAt: Date,                       // When call ended (set on end/reject)
  duration: Number,                    // In seconds (calculated on end)
  callType: String,                    // video|audio
  conversationId: ObjectId (ref: Conversation), // Optional
  createdAt: Date,
  updatedAt: Date
}
```

## Key Features

✅ **1v1 Video/Audio Calls**

- WebRTC P2P connection for direct media stream
- Socket.IO signaling server

✅ **Call Management**

- Initiate, accept, reject, end calls
- Auto-decline after 30 seconds
- Call history & statistics

✅ **Real-time Notifications**

- Incoming call notifications via socket
- Caller gets feedback on acceptance/rejection

✅ **Robust Signaling**

- SDP Offer/Answer exchange
- ICE candidate handling
- Connection state management

✅ **Production Ready**

- Error handling & cleanup
- Timeout mechanisms
- Comprehensive logging

## Environment Setup

### Server Requirements

- Node.js + Express
- MongoDB
- Socket.IO 4.8+
- STUN servers configured (default: Google STUN)

### Client Requirements

- Modern browser with WebRTC support
  - Chrome/Chromium 23+
  - Firefox 22+
  - Safari 11+
  - Edge 79+

## Security Notes

✅ All API endpoints require JWT authentication
✅ Verify user ownership before accepting/rejecting
✅ Validate call IDs before signaling
✅ CORS configured for allowed origins
✅ Use WSS (secure websocket) in production

## Troubleshooting

### Issue: "No media devices available"

- Check browser permissions
- Verify camera/microphone is connected
- Test with `navigator.mediaDevices.enumerateDevices()`

### Issue: "ICE candidates not connecting"

- Add TURN server for NAT traversal
- Check firewall/network settings
- Verify STUN server is accessible

### Issue: "Video/Audio not showing"

- Verify `getUserMedia` permissions granted
- Check `srcObject` assignment
- Monitor `ontrack` event

## Performance Tips

1. Set video constraints for lower bandwidth:

```javascript
{
  video: {
    width: { max: 640 },
    height: { max: 480 },
    frameRate: { max: 30 }
  },
  audio: true
}
```

2. Implement bitrate limiting as needed
3. Always cleanup resources (stop tracks, close PC)
4. Monitor connection state changes

## Support Files

- 📖 **VIDEO_CALL_GUIDE.md** - Comprehensive implementation guide
- 🎨 **VIDEO_CALL_DEMO.html** - Interactive demo with UI
- 💻 **VIDEO_CALL_CLIENT_EXAMPLE.js** - Reusable client class

## Next Steps

1. ✅ Backend ready to use
2. 📱 Integrate `VIDEO_CALL_CLIENT_EXAMPLE.js` into frontend
3. 🎨 Customize UI based on app design
4. 🧪 Test with demo page
5. 🚀 Deploy to production

## Questions or Issues?

Refer to:

- `VIDEO_CALL_GUIDE.md` for detailed docs
- `VIDEO_CALL_DEMO.html` for working example
- Console logs for debugging information
