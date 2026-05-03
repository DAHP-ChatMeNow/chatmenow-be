const User = require("../models/user.model");
const FriendRequest = require("../models/friend-request.model");
const Notification = require("../models/notification.model");
const Account = require("../models/account.model");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Story = require("../models/story.model");
const { getSignedUrlFromS3 } = require("../middleware/storage");
const { formatLastSeen } = require("../../utils/last-seen.helper");
const {
  emitNotificationToUser,
} = require("../../utils/realtime-notification.helper");
const {
  CONVERSATION_TYPES,
  FRIEND_REQUEST_STATUS,
} = require("../../constants");

class UserService {
  normalizeString(value) {
    return String(value || "").trim();
  }

  normalizeSearchHistoryLimit(limit) {
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed)) return 20;
    return Math.min(Math.max(parsed, 1), 50);
  }

  normalizeActivityLimit(limit) {
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed)) return 20;
    return Math.min(Math.max(parsed, 1), 100);
  }

  async resolvePostMediaUrls(mediaArray = []) {
    if (!Array.isArray(mediaArray) || mediaArray.length === 0) {
      return [];
    }

    return await Promise.all(
      mediaArray.map(async (item) => {
        if (!item?.url || String(item.url).startsWith("http")) {
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

  extractReferencedPostId(post = null) {
    const raw = post?.sharedPost?.postId;
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    return String(raw?._id || raw?.id || raw);
  }

  async resolveOriginalPostId(post = null) {
    if (!post) return null;

    let currentId =
      typeof post === "string" ? String(post) : String(post?._id || "");
    let currentDoc = typeof post === "object" ? post : null;
    const visited = new Set();

    for (let i = 0; i < 10; i += 1) {
      if (!currentId || visited.has(currentId)) break;
      visited.add(currentId);

      if (!currentDoc) {
        currentDoc = await Post.findById(currentId)
          .select("_id sharedPost.postId isDeleted")
          .lean();
      }

      if (!currentDoc || currentDoc.isDeleted) {
        break;
      }

      const nextId = this.extractReferencedPostId(currentDoc);
      if (!nextId || visited.has(String(nextId))) {
        return String(currentDoc._id);
      }

      currentId = String(nextId);
      currentDoc = null;
    }

    return currentId || null;
  }

  canViewerAccessPost(post, viewerId, viewerFriendIdSet = new Set()) {
    if (!post || post.isDeleted) return false;

    const authorId =
      typeof post.authorId === "object"
        ? String(post.authorId?._id || post.authorId)
        : String(post.authorId);
    const normalizedViewerId = String(viewerId);

    if (authorId === normalizedViewerId) return true;
    if (post.privacy === "public") return true;

    if (post.privacy === "friends") {
      return viewerFriendIdSet.has(authorId);
    }

    if (post.privacy === "custom") {
      return (post.customAudienceIds || []).some(
        (id) => String(id) === normalizedViewerId,
      );
    }

    return false;
  }

  async getViewerFriendIdSet(viewerId) {
    const viewer = await User.findById(viewerId).select("friends").lean();
    if (!viewer) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return new Set((viewer.friends || []).map((id) => String(id)));
  }

  normalizeSearchFilters(filters = {}) {
    const keyword = this.normalizeString(filters.keyword || filters.q || filters.query);
    const hometown = this.normalizeString(filters.city || filters.hometown);
    const school = this.normalizeString(filters.school);

    return {
      keyword,
      hometown,
      school,
      keywordLower: keyword.toLowerCase(),
      hometownLower: hometown.toLowerCase(),
      schoolLower: school.toLowerCase(),
    };
  }

  async saveSearchHistory(userId, filters = {}) {
    const normalized = this.normalizeSearchFilters(filters);
    if (!normalized.keyword && !normalized.hometown && !normalized.school) {
      return;
    }

    const user = await User.findById(userId).select("searchHistory");
    if (!user) return;

    const history = Array.isArray(user.searchHistory) ? [...user.searchHistory] : [];
    const matchedIndex = history.findIndex((item) => {
      const itemKeyword = String(item?.keyword || "").trim().toLowerCase();
      const itemHometown = String(item?.hometown || "").trim().toLowerCase();
      const itemSchool = String(item?.school || "").trim().toLowerCase();

      return (
        itemKeyword === normalized.keywordLower &&
        itemHometown === normalized.hometownLower &&
        itemSchool === normalized.schoolLower
      );
    });

    const now = new Date();
    const nextItem = {
      keyword: normalized.keyword,
      hometown: normalized.hometown,
      school: normalized.school,
      lastSearchedAt: now,
    };

    if (matchedIndex >= 0) {
      history.splice(matchedIndex, 1);
    }

    history.unshift(nextItem);
    user.searchHistory = history.slice(0, 30);
    user.markModified("searchHistory");
    await user.save();
  }

  async saveProfileVisitHistory(viewerId, targetUserId) {
    if (!viewerId || !targetUserId) return;
    if (String(viewerId) === String(targetUserId)) return;

    const viewer = await User.findById(viewerId).select("profileVisitHistory");
    if (!viewer) return;

    const history = Array.isArray(viewer.profileVisitHistory)
      ? [...viewer.profileVisitHistory]
      : [];
    const existingIndex = history.findIndex(
      (item) => String(item?.userId || "") === String(targetUserId),
    );

    if (existingIndex >= 0) {
      history.splice(existingIndex, 1);
    }

    history.unshift({
      userId: targetUserId,
      visitedAt: new Date(),
    });

    viewer.profileVisitHistory = history.slice(0, 50);
    viewer.markModified("profileVisitHistory");
    await viewer.save();
  }

  buildFriendRequestNotificationPayload(notification, sender, targetUrl) {
    return {
      ...notification.toObject(),
      senderName: sender?.displayName || null,
      senderAvatar: sender?.avatar || null,
      displayText: `${sender?.displayName || "Ai đó"} đã gửi cho bạn lời mời kết bạn.`,
      previewImage: sender?.avatar || null,
      targetUrl,
      isRead: false,
    };
  }

  buildCreatedAtFilter({ date, dateFrom, dateTo }) {
    const createdAtFilter = {};

    const safeDate = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const exactDate = safeDate(date) || safeDate(dateFrom) || safeDate(dateTo);
    if (exactDate) {
      const start = new Date(exactDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(exactDate);
      end.setHours(23, 59, 59, 999);

      createdAtFilter.$gte = start;
      createdAtFilter.$lte = end;
      return createdAtFilter;
    }

    return null;
  }

  async searchUsers(filters = {}, currentUserId) {
    const normalized = this.normalizeSearchFilters(filters);
    if (!normalized.keyword && !normalized.hometown && !normalized.school) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập từ khóa hoặc bộ lọc tìm kiếm",
      };
    }

    let accountIds = [];
    if (normalized.keyword) {
      const accountsByContact = await Account.find({
        $or: [
          { phoneNumber: { $regex: normalized.keyword, $options: "i" } },
          { email: { $regex: normalized.keyword, $options: "i" } },
        ],
      }).select("_id");

      accountIds = accountsByContact.map((acc) => acc._id);
    }

    const userFilter = {
      _id: { $ne: currentUserId },
    };
    const andConditions = [];

    if (normalized.keyword) {
      andConditions.push({
        $or: [
          { displayName: { $regex: normalized.keyword, $options: "i" } },
          ...(accountIds.length ? [{ accountId: { $in: accountIds } }] : []),
        ],
      });
    }

    if (normalized.hometown) {
      andConditions.push({
        hometown: { $regex: normalized.hometown, $options: "i" },
      });
    }

    if (normalized.school) {
      andConditions.push({
        school: { $regex: normalized.school, $options: "i" },
      });
    }

    if (andConditions.length > 0) {
      userFilter.$and = andConditions;
    }

    const users = await User.find(userFilter)
      .populate("accountId", "phoneNumber email")
      .select("displayName avatar bio accountId hometown school")
      .limit(20);

    const currentUser = await User.findById(currentUserId).select("friends");

    const usersWithFriendStatus = await Promise.all(
      users.map(async (user) => {
        const isFriend = currentUser.friends.includes(user._id);

        const pendingRequest = await FriendRequest.findOne({
          $or: [
            {
              sender: currentUserId,
              receiver: user._id,
              status: FRIEND_REQUEST_STATUS.PENDING,
            },
            {
              sender: user._id,
              receiver: currentUserId,
              status: FRIEND_REQUEST_STATUS.PENDING,
            },
          ],
        });

        return {
          _id: user._id,
          displayName: user.displayName,
          avatar: user.avatar,
          bio: user.bio,
          hometown: user.hometown || "",
          school: user.school || "",
          phoneNumber: user.accountId?.phoneNumber || "",
          email: user.accountId?.email || "",
          isFriend,
          hasPendingRequest: !!pendingRequest,
          requestSentByMe: pendingRequest?.sender?.toString() === currentUserId,
        };
      }),
    );

    return {
      users: usersWithFriendStatus,
      total: usersWithFriendStatus.length,
    };
  }

  async getUserProfile(userId, viewerId = null) {
    // Validate ObjectId format
    if (!userId) {
      throw {
        statusCode: 400,
        message: "User ID không hợp lệ",
      };
    }

    const user = await User.findById(userId)
      .populate("friends", "displayName avatar")
      .select("-__v");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    if (viewerId && String(viewerId) !== String(userId)) {
      await this.saveProfileVisitHistory(viewerId, userId);
    }

    return {
      _id: user._id,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      lastSeenText: formatLastSeen(user.lastSeen, user.isOnline),
      coverImage: user.coverImage,
      hometown: user.hometown,
      phoneNumber: user.phoneNumber,
      gender: user.gender,
      school: user.school,
      maritalStatus: user.maritalStatus,
      friends: user.friends,
      createdAt: user.createdAt,
    };
  }

  async getFriendProfile(viewerId, targetUserId) {
    if (!targetUserId) {
      throw {
        statusCode: 400,
        message: "User ID không hợp lệ",
      };
    }

    const [viewer, targetUser] = await Promise.all([
      User.findById(viewerId).select("friends"),
      User.findById(targetUserId)
        .populate("friends", "_id")
        .select(
          "displayName avatar bio coverImage hometown phoneNumber gender school maritalStatus isOnline lastSeen friends createdAt",
        ),
    ]);

    if (!viewer) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng hiện tại",
      };
    }

    if (!targetUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    await this.saveProfileVisitHistory(viewerId, targetUserId);

    const viewerFriendIds = new Set(
      (viewer.friends || []).map((id) => id.toString()),
    );
    const targetFriendIds = (targetUser.friends || []).map((friend) =>
      friend._id.toString(),
    );

    const isFriend = viewerFriendIds.has(targetUser._id.toString());
    const mutualFriendsCount = targetFriendIds.filter((friendId) =>
      viewerFriendIds.has(friendId),
    ).length;

    return {
      _id: targetUser._id,
      displayName: targetUser.displayName,
      avatar: targetUser.avatar,
      bio: targetUser.bio,
      coverImage: targetUser.coverImage,
      hometown: targetUser.hometown,
      phoneNumber: targetUser.phoneNumber,
      gender: targetUser.gender,
      school: targetUser.school,
      maritalStatus: targetUser.maritalStatus,
      isOnline: targetUser.isOnline,
      lastSeen: targetUser.lastSeen,
      lastSeenText: formatLastSeen(targetUser.lastSeen, targetUser.isOnline),
      friendsCount: targetFriendIds.length,
      isFriend,
      mutualFriendsCount,
      createdAt: targetUser.createdAt,
    };
  }

  async getSearchHistory(userId, { limit } = {}) {
    const safeLimit = this.normalizeSearchHistoryLimit(limit);
    const user = await User.findById(userId).select("searchHistory");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const history = (user.searchHistory || [])
      .map((item) => ({
        keyword: String(item?.keyword || ""),
        hometown: String(item?.hometown || ""),
        school: String(item?.school || ""),
        lastSearchedAt: item?.lastSearchedAt || null,
      }))
      .sort(
        (left, right) =>
          new Date(right?.lastSearchedAt || 0).getTime() -
          new Date(left?.lastSearchedAt || 0).getTime(),
      )
      .slice(0, safeLimit);

    return {
      history,
      total: history.length,
      limit: safeLimit,
    };
  }

  async clearSearchHistory(userId) {
    await User.findByIdAndUpdate(userId, { $set: { searchHistory: [] } });
    return { success: true };
  }

  async getProfileVisitHistory(userId, { limit } = {}) {
    const safeLimit = this.normalizeSearchHistoryLimit(limit);
    const user = await User.findById(userId)
      .select("profileVisitHistory")
      .populate(
        "profileVisitHistory.userId",
        "displayName avatar isOnline lastSeen hometown school",
      )
      .lean();

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const history = (user.profileVisitHistory || [])
      .filter((item) => item?.userId && item?.visitedAt)
      .sort(
        (left, right) =>
          new Date(right?.visitedAt || 0).getTime() -
          new Date(left?.visitedAt || 0).getTime(),
      )
      .slice(0, safeLimit)
      .map((item) => ({
        visitedAt: item.visitedAt,
        user: {
          _id: item.userId._id,
          displayName: item.userId.displayName || "",
          avatar: item.userId.avatar || "",
          isOnline: Boolean(item.userId.isOnline),
          lastSeen: item.userId.lastSeen || null,
          lastSeenText: formatLastSeen(item.userId.lastSeen, item.userId.isOnline),
          hometown: item.userId.hometown || "",
          school: item.userId.school || "",
        },
      }));

    return {
      history,
      total: history.length,
      limit: safeLimit,
    };
  }

  async clearProfileVisitHistory(userId) {
    await User.findByIdAndUpdate(userId, { $set: { profileVisitHistory: [] } });
    return { success: true };
  }

  async getInteractionHistory(userId, { limit } = {}) {
    const safeLimit = this.normalizeActivityLimit(limit);
    const [user, viewerFriendIdSet] = await Promise.all([
      User.findById(userId)
        .select("likeHistory commentHistory videoViewHistory")
        .lean(),
      this.getViewerFriendIdSet(userId),
    ]);

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const likeHistory = Array.isArray(user.likeHistory) ? user.likeHistory : [];
    const commentHistory = Array.isArray(user.commentHistory)
      ? user.commentHistory
      : [];
    const videoViewHistory = Array.isArray(user.videoViewHistory)
      ? user.videoViewHistory
      : [];

    const sortedLikeHistory = [...likeHistory].sort(
      (left, right) =>
        new Date(right?.likedAt || 0).getTime() -
        new Date(left?.likedAt || 0).getTime(),
    );
    const sortedCommentHistory = [...commentHistory].sort(
      (left, right) =>
        new Date(right?.commentedAt || 0).getTime() -
        new Date(left?.commentedAt || 0).getTime(),
    );
    const sortedVideoViewHistory = [...videoViewHistory].sort(
      (left, right) =>
        new Date(right?.viewedAt || 0).getTime() -
        new Date(left?.viewedAt || 0).getTime(),
    );

    const likedPostIds = [
      ...new Set(sortedLikeHistory.map((item) => String(item?.postId || "")).filter(Boolean)),
    ];
    const commentPostIds = [
      ...new Set(
        sortedCommentHistory.map((item) => String(item?.postId || "")).filter(Boolean),
      ),
    ];
    const commentIds = [
      ...new Set(
        sortedCommentHistory.map((item) => String(item?.commentId || "")).filter(Boolean),
      ),
    ];

    const storyVideoIds = [
      ...new Set(
        sortedVideoViewHistory
          .filter((item) => item?.sourceType === "story")
          .map((item) => String(item?.sourceId || ""))
          .filter(Boolean),
      ),
    ];
    const postVideoIds = [
      ...new Set(
        sortedVideoViewHistory
          .filter((item) => item?.sourceType === "post")
          .map((item) => String(item?.sourceId || ""))
          .filter(Boolean),
      ),
    ];

    const [likedPostsRaw, commentedPostsRaw, commentsRaw, storiesRaw, viewedPostVideosRaw] =
      await Promise.all([
        likedPostIds.length
          ? Post.find({
              _id: { $in: likedPostIds },
              isDeleted: { $ne: true },
            })
              .select(
                "authorId content media privacy customAudienceIds likesCount commentsCount createdAt sharedPost.postId",
              )
              .populate("authorId", "displayName avatar")
              .lean()
          : [],
        commentPostIds.length
          ? Post.find({
              _id: { $in: commentPostIds },
              isDeleted: { $ne: true },
            })
              .select(
                "authorId content media privacy customAudienceIds likesCount commentsCount createdAt sharedPost.postId",
              )
              .populate("authorId", "displayName avatar")
              .lean()
          : [],
        commentIds.length
          ? Comment.find({ _id: { $in: commentIds }, userId })
              .select("_id postId content createdAt")
              .lean()
          : [],
        storyVideoIds.length
          ? Story.find({ _id: { $in: storyVideoIds } })
              .select("authorId caption media createdAt expiresAt")
              .populate("authorId", "displayName avatar")
              .lean()
          : [],
        postVideoIds.length
          ? Post.find({
              _id: { $in: postVideoIds },
              isDeleted: { $ne: true },
            })
              .select(
                "authorId content media privacy customAudienceIds likesCount commentsCount createdAt sharedPost.postId",
              )
              .populate("authorId", "displayName avatar")
              .lean()
          : [],
      ]);

    const likedPostMap = new Map(likedPostsRaw.map((post) => [String(post._id), post]));
    const commentedPostMap = new Map(
      commentedPostsRaw.map((post) => [String(post._id), post]),
    );
    const commentMap = new Map(commentsRaw.map((comment) => [String(comment._id), comment]));
    const storyMap = new Map(storiesRaw.map((story) => [String(story._id), story]));
    const viewedPostVideoMap = new Map(
      viewedPostVideosRaw.map((post) => [String(post._id), post]),
    );
    const originalPostIdCache = new Map();

    const resolveOpenPostId = async (post) => {
      const sourcePostId = String(post?._id || "");
      if (!sourcePostId) return null;

      if (originalPostIdCache.has(sourcePostId)) {
        return originalPostIdCache.get(sourcePostId);
      }

      const openPostId = (await this.resolveOriginalPostId(post)) || sourcePostId;
      originalPostIdCache.set(sourcePostId, openPostId);
      return openPostId;
    };

    const likedPosts = [];
    for (const item of sortedLikeHistory) {
      if (likedPosts.length >= safeLimit) break;

      const postId = String(item?.postId || "");
      const post = likedPostMap.get(postId);
      if (!post) continue;
      if (!this.canViewerAccessPost(post, userId, viewerFriendIdSet)) continue;

      const media = await this.resolvePostMediaUrls(post.media || []);
      const sourcePostId = String(post._id);
      const openPostId = await resolveOpenPostId(post);
      likedPosts.push({
        likedAt: item?.likedAt || null,
        post: {
          sourcePostId,
          openPostId,
          _id: post._id,
          content: post.content || "",
          media,
          likesCount: Number(post.likesCount || 0),
          commentsCount: Number(post.commentsCount || 0),
          createdAt: post.createdAt || null,
          author: {
            _id: post.authorId?._id || post.authorId || null,
            displayName: post.authorId?.displayName || "",
            avatar: post.authorId?.avatar || "",
          },
        },
      });
    }

    if (likedPosts.length === 0 && sortedLikeHistory.length === 0) {
      const legacyLikedPosts = await Post.find({
        likes: userId,
        isDeleted: { $ne: true },
      })
        .select(
          "authorId content media privacy customAudienceIds likesCount commentsCount createdAt updatedAt sharedPost.postId",
        )
        .populate("authorId", "displayName avatar")
        .sort({ updatedAt: -1, _id: -1 })
        .limit(safeLimit)
        .lean();

      for (const post of legacyLikedPosts) {
        if (!this.canViewerAccessPost(post, userId, viewerFriendIdSet)) continue;
        const media = await this.resolvePostMediaUrls(post.media || []);
        const sourcePostId = String(post._id);
        const openPostId = await resolveOpenPostId(post);
        likedPosts.push({
          likedAt: null,
          post: {
            sourcePostId,
            openPostId,
            _id: post._id,
            content: post.content || "",
            media,
            likesCount: Number(post.likesCount || 0),
            commentsCount: Number(post.commentsCount || 0),
            createdAt: post.createdAt || null,
            author: {
              _id: post.authorId?._id || post.authorId || null,
              displayName: post.authorId?.displayName || "",
              avatar: post.authorId?.avatar || "",
            },
          },
        });
      }
    }

    const commentedPosts = [];
    for (const item of sortedCommentHistory) {
      if (commentedPosts.length >= safeLimit) break;

      const postId = String(item?.postId || "");
      const commentId = String(item?.commentId || "");
      const post = commentedPostMap.get(postId);
      const comment = commentMap.get(commentId);
      if (!post || !comment) continue;
      if (!this.canViewerAccessPost(post, userId, viewerFriendIdSet)) continue;

      const media = await this.resolvePostMediaUrls(post.media || []);
      const sourcePostId = String(post._id);
      const openPostId = await resolveOpenPostId(post);
      commentedPosts.push({
        commentedAt: item?.commentedAt || comment.createdAt || null,
        comment: {
          _id: comment._id,
          content: comment.content || "",
          createdAt: comment.createdAt || null,
        },
        post: {
          sourcePostId,
          openPostId,
          _id: post._id,
          content: post.content || "",
          media,
          likesCount: Number(post.likesCount || 0),
          commentsCount: Number(post.commentsCount || 0),
          createdAt: post.createdAt || null,
          author: {
            _id: post.authorId?._id || post.authorId || null,
            displayName: post.authorId?.displayName || "",
            avatar: post.authorId?.avatar || "",
          },
        },
      });
    }

    if (commentedPosts.length === 0 && sortedCommentHistory.length === 0) {
      const legacyComments = await Comment.find({ userId })
        .select("_id postId content createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .limit(safeLimit)
        .lean();

      const legacyCommentPostIds = [
        ...new Set(legacyComments.map((comment) => String(comment.postId || ""))),
      ].filter(Boolean);

      const legacyCommentPosts = legacyCommentPostIds.length
        ? await Post.find({
            _id: { $in: legacyCommentPostIds },
            isDeleted: { $ne: true },
          })
            .select(
              "authorId content media privacy customAudienceIds likesCount commentsCount createdAt sharedPost.postId",
            )
            .populate("authorId", "displayName avatar")
            .lean()
        : [];

      const legacyCommentPostMap = new Map(
        legacyCommentPosts.map((post) => [String(post._id), post]),
      );

      for (const comment of legacyComments) {
        const post = legacyCommentPostMap.get(String(comment.postId || ""));
        if (!post) continue;
        if (!this.canViewerAccessPost(post, userId, viewerFriendIdSet)) continue;

        const media = await this.resolvePostMediaUrls(post.media || []);
        const sourcePostId = String(post._id);
        const openPostId = await resolveOpenPostId(post);
        commentedPosts.push({
          commentedAt: comment.createdAt || null,
          comment: {
            _id: comment._id,
            content: comment.content || "",
            createdAt: comment.createdAt || null,
          },
          post: {
            sourcePostId,
            openPostId,
            _id: post._id,
            content: post.content || "",
            media,
            likesCount: Number(post.likesCount || 0),
            commentsCount: Number(post.commentsCount || 0),
            createdAt: post.createdAt || null,
            author: {
              _id: post.authorId?._id || post.authorId || null,
              displayName: post.authorId?.displayName || "",
              avatar: post.authorId?.avatar || "",
            },
          },
        });
      }
    }

    const viewedVideos = [];
    for (const item of sortedVideoViewHistory) {
      if (viewedVideos.length >= safeLimit) break;

      const sourceType = String(item?.sourceType || "story");
      const sourceId = String(item?.sourceId || "");
      if (!sourceId) continue;

      if (sourceType === "story") {
        const story = storyMap.get(sourceId);
        if (!story || story?.media?.type !== "video") continue;

        const mediaUrl =
          story?.media?.url && !String(story.media.url).startsWith("http")
            ? await getSignedUrlFromS3(story.media.url).catch(() => story.media.url)
            : story?.media?.url || "";

        viewedVideos.push({
          viewedAt: item?.viewedAt || null,
          sourceType: "story",
          story: {
            _id: story._id,
            caption: story.caption || "",
            media: {
              ...story.media,
              url: mediaUrl,
            },
            createdAt: story.createdAt || null,
            expiresAt: story.expiresAt || null,
            author: {
              _id: story.authorId?._id || story.authorId || null,
              displayName: story.authorId?.displayName || "",
              avatar: story.authorId?.avatar || "",
            },
          },
        });
        continue;
      }

      if (sourceType === "post") {
        const post = viewedPostVideoMap.get(sourceId);
        if (!post) continue;
        if (!this.canViewerAccessPost(post, userId, viewerFriendIdSet)) continue;

        const media = await this.resolvePostMediaUrls(post.media || []);
        const videoMedia = media.find((itemMedia) => itemMedia?.type === "video");
        if (!videoMedia) continue;
        const sourcePostId = String(post._id);
        const openPostId = await resolveOpenPostId(post);

        viewedVideos.push({
          viewedAt: item?.viewedAt || null,
          sourceType: "post",
          post: {
            sourcePostId,
            openPostId,
            _id: post._id,
            content: post.content || "",
            media: videoMedia,
            createdAt: post.createdAt || null,
            author: {
              _id: post.authorId?._id || post.authorId || null,
              displayName: post.authorId?.displayName || "",
              avatar: post.authorId?.avatar || "",
            },
          },
        });
      }
    }

    if (viewedVideos.length === 0 && sortedVideoViewHistory.length === 0) {
      const legacyViewedStories = await Story.find({
        viewedBy: userId,
        "media.type": "video",
      })
        .select("authorId caption media createdAt expiresAt")
        .populate("authorId", "displayName avatar")
        .sort({ createdAt: -1, _id: -1 })
        .limit(safeLimit)
        .lean();

      for (const story of legacyViewedStories) {
        const mediaUrl =
          story?.media?.url && !String(story.media.url).startsWith("http")
            ? await getSignedUrlFromS3(story.media.url).catch(() => story.media.url)
            : story?.media?.url || "";

        viewedVideos.push({
          viewedAt: null,
          sourceType: "story",
          story: {
            _id: story._id,
            caption: story.caption || "",
            media: {
              ...story.media,
              url: mediaUrl,
            },
            createdAt: story.createdAt || null,
            expiresAt: story.expiresAt || null,
            author: {
              _id: story.authorId?._id || story.authorId || null,
              displayName: story.authorId?.displayName || "",
              avatar: story.authorId?.avatar || "",
            },
          },
        });
      }
    }

    const [legacyLikedTotal, legacyCommentedTotal, legacyViewedVideosTotal] =
      await Promise.all([
        likeHistory.length === 0
          ? Post.countDocuments({
              likes: userId,
              isDeleted: { $ne: true },
            })
          : Promise.resolve(likeHistory.length),
        commentHistory.length === 0
          ? Comment.countDocuments({ userId })
          : Promise.resolve(commentHistory.length),
        videoViewHistory.length === 0
          ? Story.countDocuments({
              viewedBy: userId,
              "media.type": "video",
            })
          : Promise.resolve(videoViewHistory.length),
      ]);

    return {
      summary: {
        likedPosts: legacyLikedTotal,
        commentedPosts: legacyCommentedTotal,
        viewedVideos: legacyViewedVideosTotal,
      },
      likedPosts,
      commentedPosts,
      viewedVideos,
      limit: safeLimit,
    };
  }

  /**
   * Cập nhật profile
   */
  async updateProfile(userId, { displayName, bio, language, themeColor, hometown, phoneNumber, gender, school, maritalStatus }) {
    if (displayName && displayName.trim().length < 2) {
      throw {
        statusCode: 400,
        message: "Tên hiển thị phải có ít nhất 2 ký tự",
      };
    }

    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (bio !== undefined) updateData.bio = bio;
    if (language !== undefined) updateData.language = language;
    if (themeColor !== undefined) updateData.themeColor = themeColor;
    if (hometown !== undefined) updateData.hometown = hometown;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (gender !== undefined) updateData.gender = gender;
    if (school !== undefined) updateData.school = school;
    if (maritalStatus !== undefined) updateData.maritalStatus = maritalStatus;

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select("-__v");

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return updatedUser;
  }

  async updateAvatar(userId, avatar) {
    if (!avatar) {
      throw {
        statusCode: 400,
        message: "Vui lòng cung cấp URL avatar",
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar },
      { new: true, runValidators: true },
    )
      .select("-__v")
      .populate("friends", "_id");

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return updatedUser;
  }

  /**
   * Lấy avatar URL của user
   */
  async getUserAvatar(userId) {
    if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
      throw {
        statusCode: 400,
        message: "User ID không hợp lệ",
      };
    }

    const user = await User.findById(userId).select("avatar displayName");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return {
      avatar: user.avatar || null,
      displayName: user.displayName,
    };
  }

  /**
   * Cập nhật ảnh bìa
   */
  async updateCoverImage(userId, coverImage) {
    if (!coverImage) {
      throw {
        statusCode: 400,
        message: "Vui lòng cung cấp URL ảnh bìa",
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { coverImage },
      { new: true, runValidators: true },
    ).select("-__v");

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return updatedUser;
  }

  /**
   * Lấy danh sách bạn bè
   */
  async getContacts(userId) {
    const user = await User.findById(userId).populate(
      "friends",
      "displayName avatar bio isOnline lastSeen",
    );

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return {
      friends: user.friends.map((friend) => ({
        _id: friend._id,
        displayName: friend.displayName,
        avatar: friend.avatar,
        bio: friend.bio,
        isOnline: friend.isOnline,
        lastSeen: friend.lastSeen,
        lastSeenText: formatLastSeen(friend.lastSeen, friend.isOnline),
      })),
      total: user.friends.length,
    };
  }

  async getBlockedUsers(userId) {
    const user = await User.findById(userId).populate(
      "blockedUsers",
      "displayName avatar bio isOnline lastSeen",
    );

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    return {
      blockedUsers: (user.blockedUsers || []).map((blockedUser) => ({
        _id: blockedUser._id,
        displayName: blockedUser.displayName,
        avatar: blockedUser.avatar,
        bio: blockedUser.bio,
        isOnline: blockedUser.isOnline,
        lastSeen: blockedUser.lastSeen,
        lastSeenText: formatLastSeen(blockedUser.lastSeen, blockedUser.isOnline),
      })),
      total: (user.blockedUsers || []).length,
    };
  }

  async blockUser(userId, blockedUserId) {
    if (userId === blockedUserId) {
      throw {
        statusCode: 400,
        message: "Không thể chặn chính mình",
      };
    }

    const blockedUser = await User.findById(blockedUserId).select(
      "displayName avatar",
    );
    if (!blockedUser) {
      throw {
        statusCode: 404,
        message: "Người dùng không tồn tại",
      };
    }

    await User.findByIdAndUpdate(userId, {
      $addToSet: { blockedUsers: blockedUserId },
    });

    return {
      blockedUser: {
        _id: blockedUser._id,
        displayName: blockedUser.displayName,
        avatar: blockedUser.avatar,
      },
    };
  }

  async unblockUser(userId, blockedUserId) {
    if (userId === blockedUserId) {
      throw {
        statusCode: 400,
        message: "Không thể mở chặn chính mình",
      };
    }

    await Promise.all([
      User.findByIdAndUpdate(userId, {
        $pull: { blockedUsers: blockedUserId },
        $addToSet: { friends: blockedUserId },
      }),
      User.findByIdAndUpdate(blockedUserId, {
        $addToSet: { friends: userId },
      }),
    ]);

    return { success: true };
  }

  /**
   * Gửi lời mời kết bạn
   */
  async sendFriendRequest(senderId, receiverId) {
    if (senderId === receiverId) {
      throw {
        statusCode: 400,
        message: "Không thể kết bạn với chính mình",
      };
    }

    const [sender, receiver] = await Promise.all([
      User.findById(senderId).select("friends blockedUsers"),
      User.findById(receiverId).select("friends blockedUsers"),
    ]);

    if (!receiver || !sender) {
      throw {
        statusCode: 404,
        message: "Người dùng không tồn tại",
      };
    }

    const senderBlocked = (sender.blockedUsers || []).some(
      (id) => id.toString() === receiverId,
    );
    const receiverBlocked = (receiver.blockedUsers || []).some(
      (id) => id.toString() === senderId,
    );

    if (senderBlocked || receiverBlocked) {
      throw {
        statusCode: 403,
        message: "Không thể gửi lời mời cho người dùng đã bị chặn",
      };
    }

    if (sender.friends.includes(receiverId)) {
      throw {
        statusCode: 400,
        message: "Đã là bạn bè rồi",
      };
    }

    // Kiểm tra lời mời đã tồn tại (bất kỳ status nào)
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    });

    if (existingRequest) {
      // Nếu người kia đã gửi lời mời cho mình (pending)
      if (
        existingRequest.senderId.toString() === receiverId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message: "Người này đã gửi lời mời kết bạn cho bạn",
        };
      }

      // Nếu mình đã gửi và đang pending
      if (
        existingRequest.senderId.toString() === senderId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message: "Đã gửi lời mời trước đó",
        };
      }

      // Nếu đã bị rejected hoặc expired, update lại thành pending
      if (existingRequest.senderId.toString() === senderId) {
        existingRequest.status = FRIEND_REQUEST_STATUS.PENDING;
        existingRequest.createdAt = new Date();
        await existingRequest.save();

        // Tạo thông báo
        const notification = await Notification.create({
          recipientId: receiverId,
          senderId: senderId,
          type: "friend_request",
          referenced: existingRequest._id,
          message: "đã gửi cho bạn lời mời kết bạn.",
        });

        emitNotificationToUser(
          receiverId,
          this.buildFriendRequestNotificationPayload(
            notification,
            sender,
            `/friends/requests/${existingRequest._id}`,
          ),
        );

        return existingRequest;
      }
    }

    // Tạo lời mời mới
    const newRequest = await FriendRequest.create({ senderId, receiverId });

    // Tạo thông báo
    const notification = await Notification.create({
      recipientId: receiverId,
      senderId: senderId,
      type: "friend_request",
      referenced: newRequest._id,
      message: "đã gửi cho bạn lời mời kết bạn.",
    });

    emitNotificationToUser(
      receiverId,
      this.buildFriendRequestNotificationPayload(
        notification,
        sender,
        `/friends/requests/${newRequest._id}`,
      ),
    );

    return newRequest;
  }

  /**
   * Tìm kiếm và gửi lời mời kết bạn
   */
  async searchAndAddFriend(senderId, searchQuery) {
    if (!searchQuery) {
      throw {
        statusCode: 400,
        message: "Vui lòng nhập email, số điện thoại hoặc tên người dùng",
      };
    }

    // Tìm kiếm theo email hoặc số điện thoại trong Account
    const accountsByContact = await Account.find({
      $or: [
        { email: searchQuery.toLowerCase().trim() },
        { phoneNumber: searchQuery.trim() },
      ],
    }).select("_id");

    const accountIds = accountsByContact.map((acc) => acc._id);

    // Tìm kiếm người dùng
    const users = await User.find({
      $or: [
        { displayName: { $regex: `^${searchQuery.trim()}$`, $options: "i" } },
        { accountId: { $in: accountIds } },
      ],
      _id: { $ne: senderId },
    })
      .populate("accountId", "phoneNumber email")
      .select("displayName avatar bio accountId");

    if (users.length === 0) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    // Nếu tìm thấy nhiều kết quả
    if (users.length > 1) {
      const usersWithStatus = await Promise.all(
        users.map(async (user) => {
          const sender = await User.findById(senderId);
          const isFriend = sender.friends.includes(user._id);

          const pendingRequest = await FriendRequest.findOne({
            $or: [
              {
                senderId,
                receiverId: user._id,
                status: FRIEND_REQUEST_STATUS.PENDING,
              },
              {
                senderId: user._id,
                receiverId: senderId,
                status: FRIEND_REQUEST_STATUS.PENDING,
              },
            ],
          });

          return {
            _id: user._id,
            displayName: user.displayName,
            avatar: user.avatar,
            bio: user.bio,
            phoneNumber: user.accountId?.phoneNumber || "",
            email: user.accountId?.email || "",
            isFriend,
            hasPendingRequest: !!pendingRequest,
          };
        }),
      );

      return {
        multiple: true,
        users: usersWithStatus,
        total: usersWithStatus.length,
      };
    }

    // Chỉ có 1 kết quả - tự động gửi lời mời
    const receiverId = users[0]._id;

    // Kiểm tra đã là bạn bè chưa
    const sender = await User.findById(senderId).select("friends blockedUsers");
    if (sender.friends.includes(receiverId)) {
      throw {
        statusCode: 400,
        message: "Đã là bạn bè rồi",
        user: {
          _id: users[0]._id,
          displayName: users[0].displayName,
          avatar: users[0].avatar,
        },
      };
    }

    // Kiểm tra lời mời đã tồn tại
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    });

    const receiver = await User.findById(receiverId).select("blockedUsers");
    const senderBlocked = (sender.blockedUsers || []).some(
      (id) => id.toString() === receiverId,
    );
    const receiverBlocked = (receiver?.blockedUsers || []).some(
      (id) => id.toString() === senderId,
    );

    if (senderBlocked || receiverBlocked) {
      throw {
        statusCode: 403,
        message: "Không thể gửi lời mời cho người dùng đã bị chặn",
      };
    }

    if (existingRequest) {
      // Nếu người kia đã gửi lời mời cho mình (pending)
      if (
        existingRequest.senderId.toString() === receiverId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message:
            "Người này đã gửi lời mời kết bạn cho bạn. Vui lòng kiểm tra lời mời kết bạn",
          user: {
            _id: users[0]._id,
            displayName: users[0].displayName,
            avatar: users[0].avatar,
          },
        };
      }

      // Nếu mình đã gửi và đang pending
      if (
        existingRequest.senderId.toString() === senderId &&
        existingRequest.status === FRIEND_REQUEST_STATUS.PENDING
      ) {
        throw {
          statusCode: 400,
          message: "Đã gửi lời mời cho người này trước đó",
          user: {
            _id: users[0]._id,
            displayName: users[0].displayName,
            avatar: users[0].avatar,
          },
        };
      }

      // Nếu đã bị rejected, update lại thành pending
      if (existingRequest.senderId.toString() === senderId) {
        existingRequest.status = FRIEND_REQUEST_STATUS.PENDING;
        existingRequest.createdAt = new Date();
        await existingRequest.save();

        // Tạo thông báo
        const notification = await Notification.create({
          recipientId: receiverId,
          senderId: senderId,
          type: "friend_request",
          referenced: existingRequest._id,
          message: "đã gửi cho bạn lời mời kết bạn.",
        });

        emitNotificationToUser(
          receiverId,
          this.buildFriendRequestNotificationPayload(
            notification,
            sender,
            `/friends/requests/${existingRequest._id}`,
          ),
        );

        return {
          multiple: false,
          user: {
            _id: users[0]._id,
            displayName: users[0].displayName,
            avatar: users[0].avatar,
            phoneNumber: users[0].accountId?.phoneNumber || "",
            email: users[0].accountId?.email || "",
          },
          request: existingRequest,
        };
      }
    }

    // Tạo lời mời mới
    const newRequest = await FriendRequest.create({ senderId, receiverId });

    // Tạo thông báo
    const notification = await Notification.create({
      recipientId: receiverId,
      senderId: senderId,
      type: "friend_request",
      referenced: newRequest._id,
      message: "đã gửi cho bạn lời mời kết bạn.",
    });

    emitNotificationToUser(
      receiverId,
      this.buildFriendRequestNotificationPayload(
        notification,
        sender,
        `/friends/requests/${newRequest._id}`,
      ),
    );

    return {
      multiple: false,
      user: {
        _id: users[0]._id,
        displayName: users[0].displayName,
        avatar: users[0].avatar,
        phoneNumber: users[0].accountId?.phoneNumber || "",
        email: users[0].accountId?.email || "",
      },
      request: newRequest,
    };
  }

  /**
   * Chấp nhận/từ chối lời mời kết bạn
   */
  async respondFriendRequest(userId, requestId, status) {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw {
        statusCode: 404,
        message: "Lời mời không tồn tại",
      };
    }

    if (request.receiverId.toString() !== userId) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xử lý lời mời này",
      };
    }

    request.status = status;
    await request.save();

    if (status === FRIEND_REQUEST_STATUS.ACCEPTED) {
      const senderId = request.senderId;

      // Kiểm tra conversation đã tồn tại chưa
      const existingConv = await Conversation.findOne({
        type: CONVERSATION_TYPES.PRIVATE,
        "members.userId": { $all: [userId, senderId] },
      });

      // Tạo conversation nếu chưa có
      const conversationPromise = existingConv
        ? Promise.resolve(existingConv)
        : (async () => {
            const senderUser =
              await User.findById(senderId).select("displayName avatar");
            return Conversation.create({
              type: CONVERSATION_TYPES.PRIVATE,
              name: senderUser.displayName,
              groupAvatar: senderUser.avatar,
              members: [
                { userId, role: "member" },
                { userId: senderId, role: "member" },
              ],
            });
          })();

      await Promise.all([
        User.findByIdAndUpdate(userId, { $addToSet: { friends: senderId } }),
        User.findByIdAndUpdate(senderId, { $addToSet: { friends: userId } }),
        Notification.create({
          recipientId: senderId,
          senderId: userId,
          type: "system",
          message: "đã chấp nhận lời mời kết bạn.",
        }),
        conversationPromise,
      ]);

      const senderUser =
        await User.findById(userId).select("displayName avatar");
      emitNotificationToUser(senderId, {
        type: "system",
        senderId: userId,
        senderName: senderUser?.displayName || null,
        senderAvatar: senderUser?.avatar || null,
        displayText: `${senderUser?.displayName || "Ai đó"} đã chấp nhận lời mời kết bạn.`,
        previewImage: senderUser?.avatar || null,
        targetUrl: `/users/${userId}`,
        isRead: false,
      });

      const [senderInfo, receiverInfo] = await Promise.all([
        User.findById(senderId).select("displayName avatar bio isOnline"),
        User.findById(userId).select("displayName avatar bio isOnline"),
      ]);

      return {
        status,
        conversationId: String((await conversationPromise)._id),
        senderId,
        senderInfo,
        receiverInfo,
      };
    }

    return { status };
  }

  /**
   * Lấy danh sách lời mời kết bạn pending
   */
  async getPendingRequests(userId) {
    const requests = await FriendRequest.find({
      receiverId: userId,
      status: FRIEND_REQUEST_STATUS.PENDING,
    }).populate("senderId", "displayName avatar");

    return {
      requests: requests,
      total: requests.length,
    };
  }

  /**
   * Chấp nhận lời mời kết bạn
   */
  async acceptFriendRequest(userId, requestId) {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw {
        statusCode: 404,
        message: "Lời mời không tồn tại",
      };
    }

    if (request.receiverId.toString() !== userId) {
      throw {
        statusCode: 403,
        message: "Không có quyền xử lý",
      };
    }

    if (request.status === FRIEND_REQUEST_STATUS.ACCEPTED) {
      throw {
        statusCode: 400,
        message: "Lời mời đã được chấp nhận",
      };
    }

    request.status = FRIEND_REQUEST_STATUS.ACCEPTED;
    await request.save();

    const senderId = request.senderId;

    let conversation = await Conversation.findOne({
      type: CONVERSATION_TYPES.PRIVATE,
      $and: [
        { members: { $elemMatch: { userId } } },
        { members: { $elemMatch: { userId: senderId } } },
      ],
    }).select("_id type members updatedAt");

    if (!conversation) {
      conversation = await Conversation.create({
        type: CONVERSATION_TYPES.PRIVATE,
        members: [{ userId }, { userId: senderId }],
      });
    }

    // Lấy thông tin của cả 2 users
    const [sender, receiver] = await Promise.all([
      User.findById(senderId).select("displayName avatar bio isOnline"),
      User.findById(userId).select("displayName avatar bio isOnline"),
      User.findByIdAndUpdate(userId, { $addToSet: { friends: senderId } }),
      User.findByIdAndUpdate(senderId, { $addToSet: { friends: userId } }),
      Notification.create({
        recipientId: senderId,
        senderId: userId,
        type: "system",
        message: "đã chấp nhận lời mời kết bạn.",
      }),
    ]);

    const receiverUser =
      await User.findById(userId).select("displayName avatar");
    emitNotificationToUser(senderId, {
      type: "system",
      senderId: userId,
      senderName: receiverUser?.displayName || null,
      senderAvatar: receiverUser?.avatar || null,
      displayText: `${receiverUser?.displayName || "Ai đó"} đã chấp nhận lời mời kết bạn.`,
      previewImage: receiverUser?.avatar || null,
      targetUrl: `/users/${userId}`,
      isRead: false,
    });

    return {
      success: true,
      senderId: senderId,
      senderInfo: sender,
      receiverInfo: receiver,
      conversationId: String(conversation._id),
    };
  }

  /**
   * Từ chối lời mời kết bạn
   */
  async rejectFriendRequest(userId, requestId) {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw {
        statusCode: 404,
        message: "Lời mời không tồn tại",
      };
    }

    if (request.receiverId.toString() !== userId) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền xử lý lời mời này",
      };
    }

    const senderId = request.senderId;
    request.status = FRIEND_REQUEST_STATUS.REJECTED;
    await request.save();

    return { success: true, senderId: senderId };
  }

  /**
   * Xóa bạn bè
   */
  async removeFriend(userId, friendId) {
    if (userId === friendId) {
      throw {
        statusCode: 400,
        message: "Không thể xóa chính mình",
      };
    }

    // Xóa quan hệ bạn bè
    await Promise.all([
      User.findByIdAndUpdate(userId, { $pull: { friends: friendId } }),
      User.findByIdAndUpdate(friendId, { $pull: { friends: userId } }),
      FriendRequest.deleteMany({
        $or: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId },
        ],
      }),
    ]);

    // Tìm và xóa cuộc trò chuyện riêng tư
    const privateConversations = await Conversation.find({
      type: CONVERSATION_TYPES.PRIVATE,
      "members.userId": { $all: [userId, friendId] },
    }).select("_id");

    if (privateConversations.length > 0) {
      const convIds = privateConversations.map((c) => c._id);
      await Promise.all([
        Message.deleteMany({ conversationId: { $in: convIds } }),
        Conversation.deleteMany({ _id: { $in: convIds } }),
      ]);
    }

    return { success: true };
  }

  /**
   * Lấy email và số điện thoại của user hiện tại
   */
  async getUserEmail(userId) {
    const user = await User.findById(userId)
      .populate("accountId", "email phoneNumber")
      .select("accountId displayName");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    if (!user.accountId) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy thông tin tài khoản",
      };
    }

    return {
      email: user.accountId.email || "",
      phoneNumber: user.accountId.phoneNumber || "",
      displayName: user.displayName,
    };
  }

  /**
   * Lấy email của user theo ID
   */
  async getUserEmailById(userId) {
    const user = await User.findById(userId)
      .populate("accountId", "email phoneNumber")
      .select("accountId displayName avatar");

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    if (!user.accountId) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy thông tin tài khoản",
      };
    }

    return {
      _id: user._id,
      displayName: user.displayName,
      avatar: user.avatar,
      email: user.accountId.email || "",
      phoneNumber: user.accountId.phoneNumber || "",
    };
  }

  /**
   * Lấy danh sách tất cả người dùng (chỉ admin)
   * Hỗ trợ filter + sort + offset/limit.
   */
  async getAllUsers({
    offset,
    limit = 20,
    page,
    search = "",
    role = "all",
    status = "all",
    sortBy = "newest",
    date,
    dateFrom,
    dateTo,
  }) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    // Backward compatibility: nếu không truyền offset thì dùng page/limit như cũ.
    let offsetNum;
    if (offset !== undefined) {
      offsetNum = Math.max(0, parseInt(offset, 10) || 0);
    } else {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      offsetNum = (pageNum - 1) * limitNum;
    }

    const userFilter = {};
    const accountFilter = {};
    if (role && role !== "all") {
      accountFilter.role = role;
    }

    // status UI: all | active | inactive | premium
    if (status && status !== "all") {
      if (status === "active") {
        accountFilter.accountStatus = "active";
      } else if (status === "inactive") {
        accountFilter.accountStatus = { $in: ["suspended", "locked"] };
      } else if (status === "premium") {
        accountFilter.isPremium = true;
      }
    }

    const hasAccountConstraint = Object.keys(accountFilter).length > 0;
    if (hasAccountConstraint) {
      const constrainedAccounts =
        await Account.find(accountFilter).select("_id");
      const constrainedAccountIds = constrainedAccounts.map((acc) => acc._id);
      userFilter.accountId = { $in: constrainedAccountIds };
    }

    if (search && search.trim()) {
      const keyword = search.trim();
      const accountSearchFilter = {
        ...accountFilter,
        $or: [
          { email: { $regex: keyword, $options: "i" } },
          { phoneNumber: { $regex: keyword, $options: "i" } },
        ],
      };

      const matchedAccountsByContact =
        await Account.find(accountSearchFilter).select("_id");

      const matchedAccountIdsByContact = matchedAccountsByContact.map(
        (acc) => acc._id,
      );

      userFilter.$or = [
        { displayName: { $regex: keyword, $options: "i" } },
        { accountId: { $in: matchedAccountIdsByContact } },
      ];
    }

    const createdAtFilter = this.buildCreatedAtFilter({
      date,
      dateFrom,
      dateTo,
    });

    if (createdAtFilter) {
      userFilter.createdAt = createdAtFilter;
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name_asc: { displayName: 1 },
      name_desc: { displayName: -1 },
      online_first: { isOnline: -1, lastSeen: -1 },
    };

    const finalSort = sortMap[sortBy] || sortMap.newest;

    const [users, total] = await Promise.all([
      User.find(userFilter)
        .populate(
          "accountId",
          "email phoneNumber role isPremium premiumExpiryDate isActive accountStatus suspendedUntil statusReason createdAt",
        )
        .select("displayName avatar bio isOnline lastSeen createdAt")
        .sort(finalSort)
        .skip(offsetNum)
        .limit(limitNum),
      User.countDocuments(userFilter),
    ]);

    const pageCurrent = Math.floor(offsetNum / limitNum) + 1;
    const totalPages = Math.ceil(total / limitNum);

    return {
      users: users.map((user) => ({
        _id: user._id,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        lastSeenText: formatLastSeen(user.lastSeen, user.isOnline),
        email: user.accountId?.email || "",
        phoneNumber: user.accountId?.phoneNumber || "",
        role: user.accountId?.role || "user",
        isPremium: user.accountId?.isPremium || false,
        isActive: user.accountId?.accountStatus === "active",
        accountStatus: user.accountId?.accountStatus || "active",
        suspendedUntil: user.accountId?.suspendedUntil || null,
        statusReason: user.accountId?.statusReason || "",
        createdAt: user.createdAt,
      })),
      total,
      offset: offsetNum,
      limit: limitNum,
      page: pageCurrent,
      totalPages,
      hasNext: offsetNum + limitNum < total,
      hasPrev: offsetNum > 0,
      filters: {
        search: search || "",
        role,
        status,
        sortBy,
        date: date || "",
        dateFrom: dateFrom || "",
        dateTo: dateTo || "",
      },
    };
  }

  async updateAccountStatus(
    userId,
    { accountStatus, suspendedUntil, statusReason },
  ) {
    const user = await User.findById(userId).select(
      "accountId displayName avatar",
    );

    if (!user) {
      throw {
        statusCode: 404,
        message: "Người dùng không tồn tại",
      };
    }

    const account = await Account.findById(user.accountId);

    if (!account) {
      throw {
        statusCode: 404,
        message: "Tài khoản không tồn tại",
      };
    }

    if (!["active", "suspended", "locked"].includes(accountStatus)) {
      throw {
        statusCode: 400,
        message: "Trạng thái tài khoản không hợp lệ",
      };
    }

    const updateData = {
      accountStatus,
      isActive: accountStatus === "active",
      statusReason: statusReason || "",
      statusUpdatedAt: new Date(),
    };

    if (accountStatus === "suspended") {
      const parsedUntil = suspendedUntil ? new Date(suspendedUntil) : null;
      if (!parsedUntil || Number.isNaN(parsedUntil.getTime())) {
        throw {
          statusCode: 400,
          message:
            "Vui lòng cung cấp suspendedUntil hợp lệ cho trạng thái đình chỉ",
        };
      }

      updateData.suspendedUntil = parsedUntil;
    } else {
      updateData.suspendedUntil = null;
    }

    await Account.findByIdAndUpdate(account._id, updateData, {
      new: true,
      runValidators: true,
    });

    return {
      _id: user._id,
      email: account.email,
      role: account.role,
      accountStatus: accountStatus,
      suspendedUntil: updateData.suspendedUntil,
      statusReason: updateData.statusReason,
      isActive: updateData.isActive,
      displayName: user.displayName,
      avatar: user.avatar,
    };
  }
}

module.exports = new UserService();
