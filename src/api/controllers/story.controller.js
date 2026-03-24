const storyService = require("../service/story.service");

exports.createStory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const file = req.file;

    const story = await storyService.createStory(userId, req.body, file);
    res.status(201).json(story);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getStoryFeed = async (req, res) => {
  try {
    const stories = await storyService.getStoryFeed(req.user.userId);
    return res.status(200).json({ success: true, stories });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getStoriesByUser = async (req, res) => {
  try {
    const stories = await storyService.getStoriesByUser(
      req.user.userId,
      req.params.userId,
    );

    return res.status(200).json({ success: true, stories });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.markStoryViewed = async (req, res) => {
  try {
    const result = await storyService.markStoryViewed(
      req.user.userId,
      req.params.storyId,
    );

    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteStory = async (req, res) => {
  try {
    const result = await storyService.deleteStory(req.user.userId, req.params.storyId);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.addReaction = async (req, res) => {
  try {
    const { emoji } = req.body;
    const result = await storyService.addReaction(
      req.user.userId,
      req.params.storyId,
      emoji,
    );
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getReactions = async (req, res) => {
  try {
    const reactions = await storyService.getReactions(req.params.storyId);
    return res.status(200).json({ success: true, reactions });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};
