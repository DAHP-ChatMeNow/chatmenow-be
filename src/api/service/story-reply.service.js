const StoryReply = require("../models/story-reply.model");
const Story = require("../models/story.model");
const User = require("../models/user.model");
const { STORY_PRIVACY, STORY_SETTINGS } = require("../../constants/story.constants");

class StoryReplyService {
  async replyToStory(userId, storyId, message) {
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      throw {
        statusCode: 400,
        message: "Tin nhắn không được để trống",
      };
    }

    if (message.length > 500) {
      throw {
        statusCode: 400,
        message: "Tin nhắn không được vượt quá 500 ký tự",
      };
    }

    const [story, sender] = await Promise.all([
      Story.findOne({
        _id: storyId,
        expiresAt: { $gt: new Date() },
      }),
      User.findById(userId),
    ]);

    if (!story) {
      throw {
        statusCode: 404,
        message: "Story không tồn tại hoặc đã hết hạn",
      };
    }

    if (!sender) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const storyAuthorId = story.authorId.toString();
    const senderId = userId.toString();

    if (senderId === storyAuthorId) {
      throw {
        statusCode: 400,
        message: "Bạn không thể reply story của chính mình",
      };
    }

    const reply = await StoryReply.create({
      storyId,
      senderId: userId,
      storyAuthorId: story.authorId,
      message: message.trim(),
      expiresAt: story.expiresAt,
    });

    await reply.populate("senderId", "displayName avatar");
    await Story.findByIdAndUpdate(storyId, {
      $inc: { replyCount: 1 },
    });

    return reply.toObject();
  }

  async getReplies(storyId, viewerId) {
    const story = await Story.findOne({
      _id: storyId,
      expiresAt: { $gt: new Date() },
    });

    if (!story) {
      throw {
        statusCode: 404,
        message: "Story không tồn tại hoặc đã hết hạn",
      };
    }

    const viewerIdStr = viewerId.toString();
    const storyAuthorIdStr = story.authorId.toString();

    if (viewerIdStr !== storyAuthorIdStr) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xem replies của story này",
      };
    }

    const replies = await StoryReply.find({
      storyId,
    })
      .sort({ createdAt: -1 })
      .populate("senderId", "displayName avatar");

    return replies.map((reply) => reply.toObject());
  }

  async deleteReply(userId, replyId) {
    const reply = await StoryReply.findById(replyId);

    if (!reply) {
      throw {
        statusCode: 404,
        message: "Phản hồi không tồn tại",
      };
    }

    const userIdStr = userId.toString();
    const senderIdStr = reply.senderId.toString();
    const storyAuthorIdStr = reply.storyAuthorId.toString();

    if (userIdStr !== senderIdStr && userIdStr !== storyAuthorIdStr) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xóa reply này",
      };
    }

    await StoryReply.findByIdAndDelete(replyId);

    await Story.findByIdAndUpdate(reply.storyId, {
      $inc: { replyCount: -1 },
    });

    return {
      success: true,
      message: "Đã xóa phản hồi",
    };
  }
}

module.exports = new StoryReplyService();
