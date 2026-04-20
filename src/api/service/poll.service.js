const Poll = require("../models/poll.model");
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const mongoose = require("mongoose");

class PollService {
  /**
   * Build a safe poll response for a user.
   * - Hides voter identities if hideVoters is set (only expose counts).
   * - Hides results entirely if hideResultsBeforeVote and user hasn't voted yet.
   */
  buildPollView(poll, requestingUserId) {
    const userId = String(requestingUserId);
    const pollObj = poll.toObject ? poll.toObject() : { ...poll };

    // Has the requesting user voted at all?
    const userHasVoted = pollObj.options.some((opt) =>
      opt.votes.some((v) => String(v.userId) === userId),
    );

    const isExpired =
      pollObj.deadline && new Date(pollObj.deadline) < new Date();
    const isClosed = pollObj.isClosed || isExpired;

    const options = pollObj.options.map((opt) => {
      const voteCount = opt.votes.length;

      // Determine if this user voted for this option
      const votedByMe = opt.votes.some((v) => String(v.userId) === userId);

      // Voters list (for display) — possibly hidden
      let voters = [];
      if (!pollObj.hideVoters && (userHasVoted || isClosed)) {
        voters = opt.votes.map((v) => ({
          userId: String(v.userId),
          votedAt: v.votedAt,
        }));
      }

      // Whether to show the count
      const showCount =
        !pollObj.hideResultsBeforeVote || userHasVoted || isClosed;

      return {
        _id: String(opt._id),
        text: opt.text,
        voteCount: showCount ? voteCount : null,
        votedByMe,
        voters: pollObj.hideVoters ? [] : voters,
      };
    });

    const totalVotes = userHasVoted || !pollObj.hideResultsBeforeVote || isClosed
      ? pollObj.options.reduce((s, o) => s + o.votes.length, 0)
      : null;

    return {
      _id: String(pollObj._id),
      conversationId: String(pollObj.conversationId),
      messageId: pollObj.messageId ? String(pollObj.messageId) : null,
      createdBy: String(pollObj.createdBy),
      question: pollObj.question,
      options,
      totalVotes,
      allowMultipleChoices: pollObj.allowMultipleChoices,
      allowAddOptions: pollObj.allowAddOptions,
      hideResultsBeforeVote: pollObj.hideResultsBeforeVote,
      hideVoters: pollObj.hideVoters,
      deadline: pollObj.deadline || null,
      isClosed,
      userHasVoted,
      createdAt: pollObj.createdAt,
      updatedAt: pollObj.updatedAt,
    };
  }

  /**
   * Create a poll and attach it as a "poll" message in the conversation.
   */
  async createPoll(payload, createdBy, io) {
    const {
      conversationId,
      question,
      options,
      allowMultipleChoices = false,
      allowAddOptions = false,
      hideResultsBeforeVote = false,
      hideVoters = false,
      deadline = null,
      pinToTop = false,
    } = payload;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new Error("conversationId không hợp lệ");
    }

    const conversation = await Conversation.findById(conversationId).lean();
    if (!conversation) throw new Error("Conversation không tồn tại");

    // Check membership
    const isMember = (conversation.members || []).some(
      (m) => String(m.userId?._id || m.userId) === String(createdBy),
    );
    if (!isMember) throw new Error("Bạn không phải thành viên cuộc trò chuyện");

    if (!question?.trim()) throw new Error("Câu hỏi bình chọn là bắt buộc");
    if (!Array.isArray(options) || options.length < 2) {
      throw new Error("Bình chọn cần ít nhất 2 lựa chọn");
    }

    const cleanOptions = options
      .map((o) => ({ text: String(o.text || "").trim() }))
      .filter((o) => o.text.length > 0)
      .slice(0, 10); // max 10 options

    if (cleanOptions.length < 2) {
      throw new Error("Cần ít nhất 2 lựa chọn hợp lệ");
    }

    // Create poll doc
    const poll = await Poll.create({
      conversationId,
      createdBy,
      question: question.trim().slice(0, 200),
      options: cleanOptions,
      allowMultipleChoices,
      allowAddOptions,
      hideResultsBeforeVote,
      hideVoters,
      deadline: deadline ? new Date(deadline) : null,
    });

    // Create the associated message
    const message = await Message.create({
      conversationId,
      senderId: createdBy,
      type: "poll",
      content: question.trim().slice(0, 200),
      pollId: poll._id,
    });

    // Attach messageId back to poll
    poll.messageId = message._id;
    await poll.save();

    // Update conversation lastMessage
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: {
        content: `📊 ${question.trim()}`,
        type: "poll",
        createdAt: new Date(),
        senderId: createdBy,
      },
    });

    // Populate sender for socket event
    const populatedMessage = await Message.findById(message._id)
      .populate("senderId", "displayName avatar _id")
      .lean();

    const pollView = this.buildPollView(poll, createdBy);
    const messageWithPoll = { ...populatedMessage, poll: pollView };

    // Emit to all conversation members
    if (io) {
      io.to(String(conversationId)).emit("message:new", messageWithPoll);
    }

    // Pin if requested
    if (pinToTop) {
      await Conversation.findByIdAndUpdate(conversationId, {
        $push: {
          pinnedMessages: {
            messageId: message._id,
            pinnedAt: new Date(),
            pinnedBy: createdBy,
          },
        },
      });
    }

    return { poll: pollView, message: messageWithPoll };
  }

  /**
   * Cast a vote (or retract it if already voted for that option).
   */
  async vote(pollId, userId, optionIds) {
    if (!mongoose.Types.ObjectId.isValid(pollId)) {
      throw new Error("pollId không hợp lệ");
    }

    const poll = await Poll.findById(pollId);
    if (!poll) throw new Error("Bình chọn không tồn tại");

    if (poll.isClosed || (poll.deadline && new Date(poll.deadline) < new Date())) {
      throw new Error("Bình chọn đã kết thúc");
    }

    const userIdStr = String(userId);

    // Validate optionIds
    if (!Array.isArray(optionIds) || optionIds.length === 0) {
      throw new Error("Chọn ít nhất 1 lựa chọn");
    }
    if (!poll.allowMultipleChoices && optionIds.length > 1) {
      throw new Error("Bình chọn này không cho phép chọn nhiều phương án");
    }

    const validOptionIdStrs = poll.options.map((o) => String(o._id));
    const invalidIds = optionIds.filter((id) => !validOptionIdStrs.includes(String(id)));
    if (invalidIds.length > 0) {
      throw new Error("Một số lựa chọn không hợp lệ");
    }

    // Process votes: toggle logic for each option
    for (const opt of poll.options) {
      const optIdStr = String(opt._id);
      const userVoteIndex = opt.votes.findIndex(
        (v) => String(v.userId) === userIdStr,
      );
      const shouldVote = optionIds.includes(optIdStr);

      if (shouldVote && userVoteIndex === -1) {
        // Add vote
        opt.votes.push({ userId, votedAt: new Date() });
      } else if (!shouldVote && userVoteIndex !== -1) {
        // Remove vote from this option
        opt.votes.splice(userVoteIndex, 1);
      }
    }

    await poll.save();
    return poll;
  }

  /**
   * Add a new option to a poll (if allowAddOptions is true).
   */
  async addOption(pollId, userId, text) {
    const poll = await Poll.findById(pollId);
    if (!poll) throw new Error("Bình chọn không tồn tại");
    if (!poll.allowAddOptions) {
      throw new Error("Bình chọn này không cho phép thêm lựa chọn");
    }
    if (poll.isClosed) throw new Error("Bình chọn đã kết thúc");

    const cleanText = String(text || "").trim().slice(0, 200);
    if (!cleanText) throw new Error("Nội dung lựa chọn không được trống");
    if (poll.options.length >= 10) {
      throw new Error("Đã đạt giới hạn 10 lựa chọn");
    }

    poll.options.push({ text: cleanText, votes: [] });
    await poll.save();
    return poll;
  }

  /**
   * Close a poll (only creator or conversation admin can).
   */
  async closePoll(pollId, userId) {
    const poll = await Poll.findById(pollId);
    if (!poll) throw new Error("Bình chọn không tồn tại");
    if (String(poll.createdBy) !== String(userId)) {
      // Also allow conversation admin — skip for simplicity, creator only
      throw new Error("Chỉ người tạo mới có thể kết thúc bình chọn");
    }
    poll.isClosed = true;
    poll.closedAt = new Date();
    await poll.save();
    return poll;
  }

  /**
   * Get poll by ID, return view for requesting user.
   */
  async getPoll(pollId, userId) {
    const poll = await Poll.findById(pollId);
    if (!poll) throw new Error("Bình chọn không tồn tại");
    return this.buildPollView(poll, userId);
  }
}

module.exports = new PollService();
