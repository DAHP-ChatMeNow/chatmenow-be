const pollService = require("../service/poll.service");

const handleError = (res, err, status = 400) => {
  console.error("[PollController]", err.message);
  res.status(status).json({ success: false, message: err.message });
};

// POST /chat/conversations/:conversationId/polls
async function createPoll(req, res) {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const { conversationId } = req.params;
    const io = req.app.get("io");
    const result = await pollService.createPoll(
      { ...req.body, conversationId },
      userId,
      io,
    );
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /chat/polls/:pollId
async function getPoll(req, res) {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const { pollId } = req.params;
    const poll = await pollService.getPoll(pollId, userId);
    res.json({ success: true, poll });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /chat/polls/:pollId/vote
async function vote(req, res) {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const { pollId } = req.params;
    const { optionIds } = req.body;

    const updatedPoll = await pollService.vote(pollId, userId, optionIds);
    const pollView = pollService.buildPollView(updatedPoll, userId);

    const io = req.app.get("io");
    if (io && updatedPoll.messageId) {
      io.to(String(updatedPoll.conversationId)).emit("poll:updated", {
        messageId: String(updatedPoll.messageId),
        poll: pollView,
      });
    }

    res.json({ success: true, poll: pollView });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /chat/polls/:pollId/options
async function addOption(req, res) {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const { pollId } = req.params;
    const { text } = req.body;

    const updatedPoll = await pollService.addOption(pollId, userId, text);
    const pollView = pollService.buildPollView(updatedPoll, userId);

    const io = req.app.get("io");
    if (io && updatedPoll.messageId) {
      io.to(String(updatedPoll.conversationId)).emit("poll:updated", {
        messageId: String(updatedPoll.messageId),
        poll: pollView,
      });
    }

    res.json({ success: true, poll: pollView });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /chat/polls/:pollId/close
async function closePoll(req, res) {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const { pollId } = req.params;

    const updatedPoll = await pollService.closePoll(pollId, userId);
    const pollView = pollService.buildPollView(updatedPoll, userId);

    const io = req.app.get("io");
    if (io && updatedPoll.messageId) {
      io.to(String(updatedPoll.conversationId)).emit("poll:updated", {
        messageId: String(updatedPoll.messageId),
        poll: pollView,
      });
    }

    res.json({ success: true, poll: pollView });
  } catch (err) {
    handleError(res, err);
  }
}

module.exports = { createPoll, getPoll, vote, addOption, closePoll };
