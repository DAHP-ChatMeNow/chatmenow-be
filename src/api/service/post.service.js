const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Notification = require("../models/notification.model");
const User = require("../models/user.model");
const aiService = require("./ai.service");
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

  async getAllPostsForAdmin({
    page = 1,
    limit = 20,
    q,
    privacy,
    authorId,
    sortBy = "createdAt",
    sortOrder = "desc",
  }) {
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const keyword = String(q || "").trim();

    const filter = {};

    if (privacy && Object.values(POST_PRIVACY).includes(privacy)) {
      filter.privacy = privacy;
    }

    if (authorId) {
      filter.authorId = authorId;
    }

    if (keyword) {
      const regex = new RegExp(
        keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      const matchedUsers = await User.find({ displayName: regex })
        .select("_id")
        .lean();
      const authorIds = matchedUsers.map((u) => u._id);

      filter.$or = [{ content: regex }];
      if (authorIds.length > 0) {
        filter.$or.push({ authorId: { $in: authorIds } });
      }
    }

    const allowedSortFields = ["createdAt", "likesCount", "commentsCount"];
    const finalSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "createdAt";
    const finalSortOrder = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

    const [total, posts] = await Promise.all([
      Post.countDocuments(filter),
      Post.find(filter)
        .sort({ [finalSortBy]: finalSortOrder, _id: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .populate("authorId", "displayName avatar"),
    ]);

    const resolvedPosts = await Promise.all(
      posts.map(async (post) => this.resolvePostMedia(post.toObject())),
    );

    return {
      posts: resolvedPosts,
      total,
      page: parsedPage,
      limit: parsedLimit,
    };
  }

  async getPostDetailForAdmin(postId) {
    const post = await Post.findById(postId).populate(
      "authorId",
      "displayName avatar",
    );

    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    return await this.resolvePostMedia(post.toObject());
  }

  async getPostStatsForAdmin({ days = 30 } = {}) {
    const parsedDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000);

    const [
      totalPosts,
      postsInRange,
      totalLikesAgg,
      totalCommentsAgg,
      privacyAgg,
      dailyAgg,
      topPostsRaw,
    ] = await Promise.all([
      Post.countDocuments({}),
      Post.countDocuments({ createdAt: { $gte: since } }),
      Post.aggregate([
        { $group: { _id: null, totalLikes: { $sum: "$likesCount" } } },
      ]),
      Post.aggregate([
        { $group: { _id: null, totalComments: { $sum: "$commentsCount" } } },
      ]),
      Post.aggregate([{ $group: { _id: "$privacy", count: { $sum: 1 } } }]),
      Post.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      Post.find({})
        .sort({ likesCount: -1, commentsCount: -1, createdAt: -1 })
        .limit(5)
        .select("content likesCount commentsCount privacy createdAt authorId")
        .populate("authorId", "displayName avatar")
        .lean(),
    ]);

    const privacyStats = {
      [POST_PRIVACY.PUBLIC]: 0,
      [POST_PRIVACY.FRIENDS]: 0,
      [POST_PRIVACY.PRIVATE]: 0,
    };

    for (const row of privacyAgg) {
      if (row?._id && Object.hasOwn(privacyStats, row._id)) {
        privacyStats[row._id] = row.count;
      }
    }

    const totalLikes = totalLikesAgg?.[0]?.totalLikes || 0;
    const totalComments = totalCommentsAgg?.[0]?.totalComments || 0;
    const avgLikesPerPost = totalPosts > 0 ? totalLikes / totalPosts : 0;
    const avgCommentsPerPost = totalPosts > 0 ? totalComments / totalPosts : 0;

    const postsPerDay = dailyAgg.map((item) => {
      const y = item._id?.year;
      const m = String(item._id?.month || "").padStart(2, "0");
      const d = String(item._id?.day || "").padStart(2, "0");
      return {
        date: `${y}-${m}-${d}`,
        count: item.count,
      };
    });

    const topPosts = topPostsRaw.map((post) => ({
      _id: post._id,
      contentPreview: String(post.content || "").slice(0, 120),
      likesCount: post.likesCount || 0,
      commentsCount: post.commentsCount || 0,
      privacy: post.privacy,
      createdAt: post.createdAt,
      author: post.authorId || null,
    }));

    return {
      rangeDays: parsedDays,
      totalPosts,
      postsInRange,
      totalLikes,
      totalComments,
      avgLikesPerPost: Number(avgLikesPerPost.toFixed(2)),
      avgCommentsPerPost: Number(avgCommentsPerPost.toFixed(2)),
      privacyStats,
      postsPerDay,
      topPosts,
    };
  }

  async getPostLikesForAdmin(postId, { page = 1, limit = 20 } = {}) {
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const post = await Post.findById(postId).select("likes likesCount").lean();

    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    const allLikeIds = (post.likes || []).map((id) => id.toString());
    const total = allLikeIds.length;
    const start = (parsedPage - 1) * parsedLimit;
    const pagedIds = allLikeIds.slice(start, start + parsedLimit);

    let users = [];
    if (pagedIds.length > 0) {
      const userDocs = await User.find({ _id: { $in: pagedIds } })
        .select("displayName avatar isOnline lastSeen")
        .lean();

      const userMap = new Map(userDocs.map((u) => [u._id.toString(), u]));
      users = pagedIds.map((id) => userMap.get(id)).filter(Boolean);
    }

    return {
      users,
      total,
      page: parsedPage,
      limit: parsedLimit,
    };
  }

  async getPostCommentsForAdmin(
    postId,
    { page = 1, limit = 20, authorSource } = {},
  ) {
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const postExists = await Post.exists({ _id: postId });
    if (!postExists) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    const filter = { postId };
    if (authorSource) {
      const normalizedAuthorSource = String(authorSource).trim().toLowerCase();
      if (!["user", "ai"].includes(normalizedAuthorSource)) {
        throw {
          statusCode: 400,
          message: "authorSource phải là 'user' hoặc 'ai'",
        };
      }
      filter.authorSource = normalizedAuthorSource;
    }

    const [total, comments] = await Promise.all([
      Comment.countDocuments(filter),
      Comment.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .populate("userId", "displayName avatar isOnline lastSeen"),
    ]);

    return {
      comments: comments.map((comment) => comment.toObject()),
      total,
      page: parsedPage,
      limit: parsedLimit,
    };
  }

  async updatePostPrivacyForAdmin(postId, privacy) {
    if (!Object.values(POST_PRIVACY).includes(privacy)) {
      throw {
        statusCode: 400,
        message: "Giá trị privacy không hợp lệ",
      };
    }

    const post = await Post.findByIdAndUpdate(
      postId,
      { privacy },
      { new: true },
    ).populate("authorId", "displayName avatar");

    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    return await this.resolvePostMedia(post.toObject());
  }

  async deletePostForAdmin(postId) {
    const post = await Post.findById(postId).lean();

    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    const [commentResult, notificationResult] = await Promise.all([
      Comment.deleteMany({ postId }),
      Notification.deleteMany({ referenced: postId }),
    ]);

    await Post.findByIdAndDelete(postId);

    return {
      postId,
      deletedComments: commentResult?.deletedCount || 0,
      deletedNotifications: notificationResult?.deletedCount || 0,
    };
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

    const aiSuggestion = await this.buildAiSuggestionForPost(postId, "like");

    return {
      message: "Liked",
      isLikedByCurrentUser: true,
      aiSuggestion,
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
    const comments = await Comment.find({
      postId,
      authorSource: { $ne: "ai" },
    })
      .sort({ createdAt: 1 })
      .populate("userId", "displayName avatar");

    const aiSuggestion = await this.buildAiSuggestionForPost(
      postId,
      "open_comments",
    );

    return {
      comments,
      total: comments.length,
      aiSuggestion,
    };
  }

  async buildAiSuggestionForPost(postId, trigger) {
    try {
      if (!(await aiService.isAutoCommentEnabled())) {
        return null;
      }

      const post = await Post.findById(postId).select("content").lean();
      if (!post) {
        return null;
      }

      const recentComments = await Comment.find({ postId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(6)
        .populate("userId", "displayName")
        .lean();

      const commentLines = recentComments
        .reverse()
        .map((item) => {
          const name = item?.userId?.displayName || "Người dùng";
          const text = String(item?.content || "").slice(0, 200);
          return `${name}: ${text}`;
        })
        .join("\n");

      const prompt =
        "Bạn là trợ lý AI cho bài viết mạng xã hội. " +
        "Hãy tạo 1 câu gợi ý ngắn (tối đa 20 từ), tự nhiên để người dùng bấm hỏi AI thêm về post này.\n" +
        `Ngữ cảnh trigger: ${trigger}.\n` +
        `Nội dung post: \"${post.content || "Bài viết không có nội dung văn bản"}\"\n` +
        `Một số bình luận gần đây:\n${commentLines || "(chưa có)"}`;

      const suggestionText = await aiService.generateTextWithGemini(
        [{ role: "user", parts: [{ text: prompt }] }],
        "Muốn mình phân tích thêm góc nhìn về bài viết này không?",
      );

      const suggestedUserPrompt =
        trigger === "like"
          ? "Giải thích thêm về cảm xúc trong bài đăng này."
          : "Phân tích thêm nội dung và cảm xúc trong bài đăng này.";

      return {
        trigger,
        text: suggestionText,
        action: "ask_ai_in_chat",
        suggestedUserPrompt,
        autoSend: true,
      };
    } catch (error) {
      return null;
    }
  }

  async askAiAboutPost(userId, postId, content, conversationId) {
    const question = String(content || "").trim();
    if (!question) {
      throw {
        statusCode: 400,
        message: "Nội dung hỏi AI không được để trống",
      };
    }

    const post = await Post.findById(postId)
      .select("content authorId media createdAt")
      .populate("authorId", "displayName")
      .lean();

    if (!post) {
      throw {
        statusCode: 404,
        message: "Bài viết không tồn tại",
      };
    }

    const recentComments = await Comment.find({ postId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .populate("userId", "displayName")
      .lean();

    const rawMedia = post.media || [];
    const mediaStats = rawMedia.reduce(
      (acc, item) => {
        if (item?.type === "video") {
          acc.videoCount += 1;
        } else if (item?.type === "image") {
          acc.imageCount += 1;
        } else {
          acc.otherCount += 1;
        }

        if (item?.duration && Number.isFinite(Number(item.duration))) {
          acc.totalVideoDuration += Number(item.duration);
        }

        return acc;
      },
      {
        videoCount: 0,
        imageCount: 0,
        otherCount: 0,
        totalVideoDuration: 0,
      },
    );

    const isVideoPost = mediaStats.videoCount > 0;
    const isImagePost = !isVideoPost && mediaStats.imageCount > 0;
    const isTextOnlyPost =
      !isVideoPost && !isImagePost && rawMedia.length === 0;

    let mediaSpecificGuide =
      "Ưu tiên phân tích ý chính và cảm xúc trong phần văn bản của bài đăng.";

    if (isVideoPost) {
      mediaSpecificGuide =
        "Đây là bài có video. Hãy ưu tiên phân tích theo trải nghiệm người xem: nhịp nội dung, cảm xúc chính, điểm gây chú ý, và gợi ý 1-2 hướng thảo luận tiếp theo. Nếu chưa xem trực tiếp được video, nói rõ bạn đang suy luận từ mô tả và metadata video.";
    } else if (isImagePost) {
      mediaSpecificGuide =
        "Đây là bài có ảnh. Hãy ưu tiên phân tích cảm xúc thị giác, thông điệp hình ảnh, và mối liên hệ giữa caption với ảnh; thêm 1 câu hỏi gợi mở thảo luận.";
    } else if (isTextOnlyPost) {
      mediaSpecificGuide =
        "Đây là bài chỉ có text. Hãy đi sâu vào ngôn từ, sắc thái cảm xúc, ngữ cảnh người viết và nêu góc nhìn đồng cảm/phan bien một cách lịch sự.";
    }

    const mediaContext = rawMedia
      .map((item, index) => {
        const mediaType = item?.type || "unknown";
        const duration = item?.duration
          ? `, duration=${Math.round(Number(item.duration))}s`
          : "";
        const source = String(item?.url || "").slice(0, 320);
        return `[${index + 1}] type=${mediaType}${duration}, source=${source || "N/A"}`;
      })
      .join("\n");

    const commentContext = recentComments
      .reverse()
      .map((item) => {
        const name = item?.userId?.displayName || "Người dùng";
        const text = String(item?.content || "").slice(0, 240);
        return `${name}: ${text}`;
      })
      .join("\n");

    const contextNote =
      "Người dùng đang hỏi về một bài post. Hãy dùng ngữ cảnh này để trả lời sát nội dung:\n" +
      "Mục tiêu: trả lời tập trung, không lan man, nhưng đầy đủ ý chính.\n" +
      "Yêu cầu đầu ra:\n" +
      "- Viết tiếng Việt tự nhiên, khoảng 250-380 từ.\n" +
      "- Không mở đầu xã giao kiểu 'Chào bạn'.\n" +
      "- Không nhắc lại nguyên văn đề bài dài dòng.\n" +
      "- Bám sát dữ liệu được cung cấp, không suy diễn quá xa.\n" +
      "- Mỗi mục cần 2-3 câu, có ví dụ/bằng chứng cụ thể từ nội dung post hoặc media metadata nếu có.\n" +
      "- Trình bày đúng 4 dòng theo mẫu sau:\n" +
      "Ý chính: ...\n" +
      "Cảm xúc nổi bật: ...\n" +
      "Bằng chứng từ bài đăng: ...\n" +
      "Gợi ý trao đổi tiếp: ...\n" +
      `Hướng phân tích theo loại media: ${mediaSpecificGuide}\n` +
      `- Tác giả post: ${post.authorId?.displayName || "Không rõ"}\n` +
      `- Thời gian đăng: ${post.createdAt ? new Date(post.createdAt).toISOString() : "Không rõ"}\n` +
      `- Nội dung post: \"${post.content || "Bài viết không có nội dung văn bản"}\"\n` +
      `- Thống kê media: videos=${mediaStats.videoCount}, images=${mediaStats.imageCount}, others=${mediaStats.otherCount}, totalVideoDuration=${Math.round(mediaStats.totalVideoDuration)}s\n` +
      `- Media đính kèm (ảnh/video):\n${mediaContext || "(không có media)"}\n` +
      `- Bình luận gần đây:\n${commentContext || "(chưa có bình luận)"}`;

    return await aiService.sendMessageToAi(userId, {
      content: question,
      conversationId,
      contextNote,
      historyLimit: 10,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1200,
      },
      timeoutMs: 30000,
    });
  }

  /**
   * Thêm comment
   */
  async addComment(userId, postId, content, replyToCommentId = null) {
    let validatedReplyToCommentId = null;

    if (replyToCommentId) {
      const parentComment = await Comment.findOne({
        _id: replyToCommentId,
        postId,
      }).select("_id authorSource");

      if (!parentComment) {
        throw {
          statusCode: 404,
          message: "Không tìm thấy comment cha để trả lời",
        };
      }

      if (parentComment.authorSource === "ai") {
        throw {
          statusCode: 400,
          message:
            "Không thể reply AI bằng comment post. Hãy dùng tính năng chat AI cho bài viết này.",
        };
      }

      validatedReplyToCommentId = parentComment._id;
    }

    const newComment = await Comment.create({
      postId,
      userId,
      content,
      replyToCommentId: validatedReplyToCommentId,
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

    return newComment.toObject();
  }
}

module.exports = new PostService();
