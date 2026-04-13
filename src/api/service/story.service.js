const Story = require("../models/story.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const { uploadToS3, getSignedUrlFromS3 } = require("../middleware/storage");
const { STORY_PRIVACY, STORY_SETTINGS } = require("../../constants/story.constants");

class StoryService {
  async resolveStoryMedia(storyObj) {
    if (!storyObj?.media?.url) return storyObj;

    if (storyObj.media.url.startsWith("http")) {
      return storyObj;
    }

    try {
      const signedUrl = await getSignedUrlFromS3(storyObj.media.url);
      return {
        ...storyObj,
        media: {
          ...storyObj.media,
          url: signedUrl,
        },
      };
    } catch {
      return storyObj;
    }
  }

  canUserViewStory(story, viewerId, viewerFriendIds = []) {
    const authorId = story.authorId?.toString();
    if (!authorId) return false;

    if (authorId === viewerId.toString()) return true;
    if (story.privacy === STORY_PRIVACY.PUBLIC) return true;
    if (
      story.privacy === STORY_PRIVACY.FRIENDS &&
      viewerFriendIds.includes(authorId)
    ) {
      return true;
    }

    return false;
  }

  async createStory(userId, { caption = "", privacy = STORY_PRIVACY.FRIENDS, videoDuration, musicUrl = null, musicTitle = null, musicArtist = null }, file) {
    if (!file) {
      throw {
        statusCode: 400,
        message: "Vui lòng chọn ảnh hoặc video để đăng tin",
      };
    }

    const isImage = file.mimetype.startsWith("image/");
    const isVideo = file.mimetype.startsWith("video/");

    if (!isImage && !isVideo) {
      throw {
        statusCode: 400,
        message: "Story chỉ hỗ trợ ảnh hoặc video",
      };
    }

    const allowedPrivacy = Object.values(STORY_PRIVACY);
    if (!allowedPrivacy.includes(privacy)) {
      throw {
        statusCode: 400,
        message: "Chế độ riêng tư không hợp lệ",
      };
    }

    let duration = 0;
    if (isVideo) {
      duration = Number(videoDuration || 0);
      if (!duration || Number.isNaN(duration)) {
        throw {
          statusCode: 400,
          message: "Vui lòng gửi thời lượng video story",
        };
      }

      if (duration > STORY_SETTINGS.MAX_VIDEO_DURATION_SECONDS) {
        throw {
          statusCode: 400,
          message: `Video story vượt quá ${STORY_SETTINGS.MAX_VIDEO_DURATION_SECONDS} giây`,
        };
      }
    }

    const s3Key = await uploadToS3(file, "stories");

    const expiresAt = new Date(
      Date.now() + STORY_SETTINGS.EXPIRE_HOURS * 60 * 60 * 1000,
    );

    const newStory = await Story.create({
      authorId: userId,
      caption,
      privacy,
      media: {
        url: s3Key,
        type: isImage ? "image" : "video",
        duration,
      },
      musicUrl: musicUrl || null,
      musicTitle: musicTitle || null,
      musicArtist: musicArtist || null,
      expiresAt,
    });

    await newStory.populate("authorId", "displayName avatar");

    const storyObj = {
      ...newStory.toObject(),
      isViewedByCurrentUser: false,
    };

    return this.resolveStoryMedia(storyObj);
  }

  async getStoryFeed(userId) {
    const currentUser = await User.findById(userId).select("friends");
    if (!currentUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const friendIds = (currentUser.friends || []).map((id) => id.toString());
    const allowedFriendAuthorIds = [userId.toString(), ...friendIds];

    const activeStories = await Story.find({
      expiresAt: { $gt: new Date() },
      $or: [
        { privacy: STORY_PRIVACY.PUBLIC },
        {
          privacy: STORY_PRIVACY.FRIENDS,
          authorId: { $in: allowedFriendAuthorIds },
        },
        {
          privacy: STORY_PRIVACY.PRIVATE,
          authorId: userId,
        },
      ],
    })
      .sort({ createdAt: -1 })
      .populate("authorId", "displayName avatar");

    const storyGroupsMap = new Map();

    for (const story of activeStories) {
      const storyObj = story.toObject();
      const resolvedStory = await this.resolveStoryMedia({
        ...storyObj,
        isViewedByCurrentUser: (storyObj.viewedBy || []).some(
          (viewerId) => viewerId.toString() === userId.toString(),
        ),
      });

      const authorId = resolvedStory.authorId?._id?.toString();
      if (!authorId) continue;

      if (!storyGroupsMap.has(authorId)) {
        storyGroupsMap.set(authorId, {
          user: resolvedStory.authorId,
          latestStoryAt: resolvedStory.createdAt,
          hasUnviewed: !resolvedStory.isViewedByCurrentUser,
          stories: [],
        });
      }

      const group = storyGroupsMap.get(authorId);
      group.stories.push(resolvedStory);
      group.hasUnviewed = group.hasUnviewed || !resolvedStory.isViewedByCurrentUser;

      if (new Date(resolvedStory.createdAt) > new Date(group.latestStoryAt)) {
        group.latestStoryAt = resolvedStory.createdAt;
      }
    }

    return Array.from(storyGroupsMap.values())
      .map((group) => ({
        ...group,
        stories: group.stories.sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
        ),
      }))
      .sort((a, b) => {
        if (a.user?._id?.toString() === userId.toString()) return -1;
        if (b.user?._id?.toString() === userId.toString()) return 1;

        if (a.hasUnviewed !== b.hasUnviewed) {
          return a.hasUnviewed ? -1 : 1;
        }

        return new Date(b.latestStoryAt) - new Date(a.latestStoryAt);
      });
  }

  async getStoriesByUser(viewerId, targetUserId) {
    const [viewer, targetUser] = await Promise.all([
      User.findById(viewerId).select("friends"),
      User.findById(targetUserId).select("_id"),
    ]);

    if (!viewer || !targetUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const isOwner = viewerId.toString() === targetUserId.toString();
    const isFriend = (viewer.friends || []).some(
      (id) => id.toString() === targetUserId.toString(),
    );

    const privacyConditions = [
      { privacy: STORY_PRIVACY.PUBLIC },
      ...(isOwner ? [{ privacy: STORY_PRIVACY.PRIVATE }] : []),
      ...(isOwner || isFriend ? [{ privacy: STORY_PRIVACY.FRIENDS }] : []),
    ];

    const stories = await Story.find({
      authorId: targetUserId,
      expiresAt: { $gt: new Date() },
      $or: privacyConditions,
    })
      .sort({ createdAt: 1 })
      .populate("authorId", "displayName avatar");

    return Promise.all(
      stories.map((story) => {
        const storyObj = story.toObject();
        return this.resolveStoryMedia({
          ...storyObj,
          isViewedByCurrentUser: (storyObj.viewedBy || []).some(
            (viewerIdInStory) => viewerIdInStory.toString() === viewerId.toString(),
          ),
        });
      }),
    );
  }

  async markStoryViewed(userId, storyId) {
    const [story, viewer] = await Promise.all([
      Story.findOne({
        _id: storyId,
        expiresAt: { $gt: new Date() },
      }),
      User.findById(userId).select("friends"),
    ]);

    if (!story) {
      throw {
        statusCode: 404,
        message: "Story không tồn tại hoặc đã hết hạn",
      };
    }

    if (!viewer) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const viewerFriendIds = (viewer.friends || []).map((id) => id.toString());
    if (!this.canUserViewStory(story, userId, viewerFriendIds)) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xem story này",
      };
    }

    await Story.findByIdAndUpdate(storyId, {
      $addToSet: { viewedBy: userId },
    });

    return { success: true };
  }

  async deleteStory(userId, storyId) {
    const story = await Story.findById(storyId);

    if (!story) {
      throw {
        statusCode: 404,
        message: "Story không tồn tại",
      };
    }

    if (story.authorId.toString() !== userId.toString()) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xóa story này",
      };
    }

    await Story.findByIdAndDelete(storyId);

    return {
      success: true,
      message: "Đã xóa story",
    };
  }

  async addReaction(userId, storyId, emoji) {
    const [story, viewer] = await Promise.all([
      Story.findOne({
        _id: storyId,
        expiresAt: { $gt: new Date() },
      }),
      User.findById(userId).select("friends"),
    ]);

    if (!story) {
      throw {
        statusCode: 404,
        message: "Story không tồn tại hoặc đã hết hạn",
      };
    }

    if (!viewer) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const viewerFriendIds = (viewer.friends || []).map((id) => id.toString());
    if (!this.canUserViewStory(story, userId, viewerFriendIds)) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền react story này",
      };
    }

    if (!emoji || typeof emoji !== "string") {
      throw {
        statusCode: 400,
        message: "Emoji không hợp lệ",
      };
    }

    const existingReaction = story.reactions.find((r) => r.emoji === emoji);

    if (existingReaction) {
      const userAlreadyReacted = existingReaction.users.some(
        (id) => id.toString() === userId.toString(),
      );

      if (userAlreadyReacted) {
        existingReaction.users = existingReaction.users.filter(
          (id) => id.toString() !== userId.toString(),
        );

        if (existingReaction.users.length === 0) {
          story.reactions = story.reactions.filter((r) => r.emoji !== emoji);
        }
      } else {
        existingReaction.users.push(userId);
      }
    } else {
      story.reactions.push({
        emoji,
        users: [userId],
      });

      // Create notification
      const storyAuthorId = story.authorId.toString();
      if (storyAuthorId !== userId.toString()) {
        await Notification.create({
          type: "story_react",
          recipientId: storyAuthorId,
          senderId: userId,
          referenced: story._id,
          isRead: false
        }).catch(() => { }); // gracefully fail if needed
      }
    }

    await story.save();

    return {
      success: true,
      reactions: story.reactions,
    };
  }

  async getReactions(storyId) {
    const story = await Story.findById(storyId)
      .select("reactions")
      .populate("reactions.users", "displayName avatar");

    if (!story) {
      throw {
        statusCode: 404,
        message: "Story không tồn tại",
      };
    }

    return story.reactions || [];
  }
}

module.exports = new StoryService();
