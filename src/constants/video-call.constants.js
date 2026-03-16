const VIDEO_CALL_STATUS = {
  INITIATED: "initiated",
  RINGING: "ringing",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  MISSED: "missed",
  ENDED: "ended",
};

const CALL_TYPE = {
  AUDIO: "audio",
  VIDEO: "video",
};

const REJECTION_REASON = {
  DECLINED: "declined",
  TIMEOUT: "timeout",
  OFFLINE: "offline",
  TECHNICAL_ISSUE: "technical_issue",
};

const SOCKET_EVENTS = {
  // Call initiation
  INITIATE_CALL: "initiate-call",
  CALL_RINGING: "call-ringing",

  // WebRTC Signaling
  CALL_OFFER: "call-offer",
  CALL_ANSWER: "call-answer",
  ICE_CANDIDATE: "ice-candidate",

  // Call control - Actions (sent BY user)
  ACCEPT_CALL: "accept-call",
  REJECT_CALL: "reject-call",
  END_CALL: "end-call",

  // Call control - Acknowledgments (received FROM server)
  CALL_ACCEPTED: "call-accepted", // ← Emitted by server to CALLER when B accepts
  CALL_REJECTED: "call-rejected", // ← Emitted by server to CALLER when B rejects
  CALL_ENDED: "call-ended",
};

module.exports = {
  VIDEO_CALL_STATUS,
  CALL_TYPE,
  REJECTION_REASON,
  SOCKET_EVENTS,
};
