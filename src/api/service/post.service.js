const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Notification = require("../models/notification.model");
const User = require("../models/user.model");
const { POST_PRIVACY } = require("../../constants");
const { uploadToS3, getSignedUrlFromS3 } = require("../middleware/storage");
const {
  emitNotificationToUser,
} = require("../../utils/realtime-notification.helper");

class PostService {
  hasUserLikedPost(post, userId) {
    if (!post?.likes || post.likes.length === 0) return false;
    const userIdString = userId.toString();
    return post.likes.some((id) => id.toString() === userIdString);
  }

  /**
   * Helper: Convert S3 keys trong media array thành presigned URLs
   */
  async resolveMediaUrls(mediaArray = []) {
    if (!mediaArray || mediaArray.length === 0) return [];

    return await Promise.all(
      mediaArray.map(async (item) => {
        // Nếu url đã là http (default avatar, v.v.) thì giữ nguyên
        if (!item.url || item.url.startsWith("http")) {
          return item;
        }
        try {
          const signedUrl = await getSignedUrlFromS3(item.url);
          return { ...item, url: signedUrl };
        } catch {
          return item;
        }
      }),
    );
  }

  /**
   * Helper: Resolve toàn bộ media cho 1 post object
   */
  async resolvePostMedia(postObj) {
    if (!postObj.media || postObj.media.length === 0) return postObj;
    const resolvedMedia = await this.resolveMediaUrls(postObj.media);
    return { ...postObj, media: resolvedMedia };
  }

  /**
   * Lấy newsfeed
   */
  async getNewsFeed(userId, { page = 1, limit = 10 }) {
    const posts = await Post.find({ privacy: POST_PRIVACY.PUBLIC })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("authorId", "displayName avatar");

    // Thêm flag isLikedByCurrentUser + resolve media URLs
    const postsWithLikeStatus = await Promise.all(
      posts.map(async (post) => {
        const postObj = {
          ...post.toObject(),
          isLikedByCurrentUser: this.hasUserLikedPost(post, userId),
        };
        return await this.resolvePostMedia(postObj);
      }),
    );

    return {
      posts: postsWithLikeStatus,
      total: posts.length,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Tạo bài viết mới
   */
  async createPost(userId, { content, privacy, videoDurations }, files = []) {
    // Upload media files nếu có
    const mediaArray = [];

    if (files && files.length > 0) {
      let videoIndex = 0;

      for (const file of files) {
        // Xác định loại file (image hoặc video)
        const fileType = file.mimetype.startsWith("image/") ? "image" : "video";

        // Validate thời lượng video không quá 5 phút (300 giây)
        if (fileType === "video") {
          const duration =
            videoDurations && videoDurations[videoIndex]
              ? parseFloat(videoDurations[videoIndex])
              : 0;

          if (duration > 300) {
            throw {
              statusCode: 400,
              message: `Video ${videoIndex + 1} có thời lượng ${Math.round(duration)}s, vượt quá giới hạn 5 phút (300s)`,
            };
          }

          videoIndex++;
        }

        // Upload file lên S3
        const s3Key = await uploadToS3(file, "posts");

        const mediaItem = {
          url: s3Key,
          type: fileType,
        };

        // Thêm duration cho video
        if (
          fileType === "video" &&
          videoDurations &&
          videoDurations[videoIndex - 1]
        ) {
          mediaItem.duration = parseFloat(videoDurations[videoIndex - 1]);
        }

        mediaArray.push(mediaItem);
      }
    }

    const newPost = await Post.create({
      authorId: userId,
      content,
      privacy,
      media: mediaArray,
    });

    const populatedPost = await newPost.populate(
      "authorId",
      "displayName avatar",
    );
    const postObj = populatedPost.toObject();
    return await this.resolvePostMedia(postObj);
  }

  /**
   * Lấy bài viết của user hiện tại
   */
  async getMyPosts(userId, { page = 1, limit = 10 }) {
    const total = await Post.countDocuments({ authorId: userId });
    const posts = await Post.find({ authorId: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("authorId", "displayName avatar");

    const resolvedPosts = await Promise.all(
      posts.map(async (post) => {
        const postObj = {
          ...post.toObject(),
          isLikedByCurrentUser: this.hasUserLikedPost(post, userId),
        };
        return await this.resolvePostMedia(postObj);
      }),
    );

    return {
      posts: resolvedPosts,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Lấy chi tiết bài viết
   */
  async getPostDetail(postId) {
    const post = await Post.findById(postId).populate(
      "authorId",
      "displayName avatar",
    );
    if (!post) return null;
    const postObj = post.toObject();
    return await this.resolvePostMedia(postObj);
  }

  /**
   * Toggle like/bỏ like bài viết
   */
  async toggleLikePost(userId, postId) {
    const post = await Post.findById(postId);
    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    const isLiked = this.hasUserLikedPost(post, userId);

    if (isLiked) {
      await Post.findByIdAndUpdate(postId, {
        $pull: { likes: userId },
        $set: { likesCount: Math.max((post.likesCount || 0) - 1, 0) },
      });

      return {
        message: "Unliked",
        isLikedByCurrentUser: false,
      };
    }

    await Post.findByIdAndUpdate(
      postId,
      {
        $addToSet: { likes: userId },
        $inc: { likesCount: 1 },
      },
      { new: true },
    ).populate("authorId", "displayName avatar");

    // Tạo notification
    if (post.authorId.toString() !== userId) {
      const actor = await User.findById(userId).select("displayName avatar");
      const notification = await Notification.create({
        recipientId: post.authorId,
        senderId: userId,
        type: "post_like",
        referenced: postId,
        message: "đã thích bài viết của bạn.",
      });

      emitNotificationToUser(post.authorId, {
        ...notification.toObject(),
        senderName: actor?.displayName || null,
        senderAvatar: actor?.avatar || null,
        displayText: `${actor?.displayName || "Ai đó"} đã thích bài viết của bạn.`,
        previewImage:
          post.media?.[0]?.url ||
          post.authorId?.avatar ||
          actor?.avatar ||
          null,
        targetUrl: `/posts/${postId}`,
        isRead: false,
      });
    }

    return {
      message: "Liked",
      isLikedByCurrentUser: true,
    };
  }

  /**
   * Unlike bài viết
   */
  async unlikePost(userId, postId) {
    const post = await Post.findById(postId);
    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    const isLiked = this.hasUserLikedPost(post, userId);
    if (!isLiked) {
      return {
        message: "Post chưa được like",
        isLikedByCurrentUser: false,
      };
    }

    await Post.findByIdAndUpdate(postId, {
      $pull: { likes: userId },
      $set: { likesCount: Math.max((post.likesCount || 0) - 1, 0) },
    });

    return {
      message: "Unliked",
      isLikedByCurrentUser: false,
    };
  }

  /**
   * Lấy danh sách comment
   */
  async getComments(postId) {
    const comments = await Comment.find({ postId })
      .sort({ createdAt: 1 })
      .populate("userId", "displayName avatar");

    return {
      comments,
      total: comments.length,
    };
  }

  /**
   * Thêm comment
   */
  async addComment(userId, postId, content) {
    const newComment = await Comment.create({
      postId,
      userId,
      content,
    });

    // Tăng số lượng comment
    const post = await Post.findByIdAndUpdate(postId, {
      $inc: { commentsCount: 1 },
    });

    // Populate user info
    await newComment.populate("userId", "displayName avatar");

    // Tạo notification
    if (post && post.authorId.toString() !== userId) {
      const actor = await User.findById(userId).select("displayName avatar");
      const notification = await Notification.create({
        recipientId: post.authorId,
        senderId: userId,
        type: "post_comment",
        referenced: postId,
        message: "đã bình luận về bài viết của bạn.",
      });

      emitNotificationToUser(post.authorId, {
        ...notification.toObject(),
        senderName: actor?.displayName || null,
        senderAvatar: actor?.avatar || null,
        displayText: `${actor?.displayName || "Ai đó"} đã bình luận về bài viết của bạn.`,
        previewImage:
          post.media?.[0]?.url ||
          post.authorId?.avatar ||
          actor?.avatar ||
          null,
        targetUrl: `/posts/${postId}`,
        isRead: false,
      });
    }

    return newComment;
  }
}

module.exports = new PostService();
