const storyReplyService = require("../service/story-reply.service");

exports.replyToStory = async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.userId;
    const storyId = req.params.storyId;

    const reply = await storyReplyService.replyToStory(userId, storyId, message);
    res.status(201).json(reply);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getReplies = async (req, res) => {
  try {
    const storyId = req.params.storyId;
    const userId = req.user.userId;

    const replies = await storyReplyService.getReplies(storyId, userId);
    return res.status(200).json({ success: true, replies });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteReply = async (req, res) => {
  try {
    const replyId = req.params.replyId;
    const userId = req.user.userId;

    const result = await storyReplyService.deleteReply(userId, replyId);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};
