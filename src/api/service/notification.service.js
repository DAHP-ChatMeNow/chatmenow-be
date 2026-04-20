const Notification = require("../models/notification.model");
const Post = require("../models/post.model");
const FriendRequest = require("../models/friend-request.model");
const VideoCall = require("../models/video-call.model");

function getNotificationTypeLabel(type) {
  switch (type) {
    case "friend_request":
      return "đã gửi cho bạn lời mời kết bạn.";
    case "post_like":
      return "đã thích bài viết của bạn.";
    case "post_comment":
      return "đã bình luận về bài viết của bạn.";
    case "reel_like":
      return "đã thích thước phim (reel) của bạn.";
    case "reel_comment":
      return "đã bình luận thước phim (reel) của bạn.";
    case "story_react":
      return "đã thả cảm xúc về story của bạn.";
    case "story_reply":
      return "đã phản hồi story của bạn.";
    case "video_call":
      return "đang gọi cho bạn";
    case "group_invite":
      return "đã mời bạn vào nhóm.";
    case "group_member_request":
      return "đã gửi yêu cầu thêm thành viên, cần bạn duyệt.";
    case "mention":
      return "đã nhắc đến bạn trong cuộc trò chuyện.";
    case "system":
      return "có một thông báo mới.";
    default:
      return "có một thông báo mới.";
  }
}

function pickPreviewImage(notification, referencedDoc) {
  if (!referencedDoc) return null;

  if (
    notification.type === "post_like" ||
    notification.type === "post_comment"
  ) {
    const firstMedia = Array.isArray(referencedDoc.media)
      ? referencedDoc.media[0]
      : null;
    return firstMedia?.url || referencedDoc.authorId?.avatar || null;
  }

  if (
    notification.type === "reel_like" ||
    notification.type === "reel_comment"
  ) {
    return referencedDoc.videoUrl || referencedDoc.userId?.avatar || null;
  }

  if (
    notification.type === "story_react" ||
    notification.type === "story_reply"
  ) {
    return referencedDoc.media?.url || referencedDoc.authorId?.avatar || null;
  }

  if (notification.type === "friend_request") {
    return referencedDoc.senderId?.avatar || null;
  }

  if (notification.type === "video_call") {
    return referencedDoc.callerId?.avatar || null;
  }

  return null;
}

async function hydrateReferenced(notification) {
  if (!notification?.referenced) {
    return null;
  }

  const referencedId = notification.referenced;

  if (
    notification.type === "post_like" ||
    notification.type === "post_comment"
  ) {
    return await Post.findById(referencedId)
      .populate("authorId", "displayName avatar")
      .select("content media authorId createdAt");
  }

  if (
    notification.type === "reel_like" ||
    notification.type === "reel_comment"
  ) {
    const Reel = require("../models/reel.model");
    return await Reel.findById(referencedId)
      .populate("userId", "displayName avatar")
      .select("caption videoUrl userId createdAt");
  }

  if (
    notification.type === "story_react" ||
    notification.type === "story_reply"
  ) {
    const Story = require("../models/story.model");
    return await Story.findById(referencedId)
      .populate("authorId", "displayName avatar")
      .select("caption media authorId createdAt");
  }

  if (notification.type === "friend_request") {
    return await FriendRequest.findById(referencedId)
      .populate("senderId", "displayName avatar")
      .populate("receiverId", "displayName avatar")
      .select("senderId receiverId status createdAt");
  }

  if (notification.type === "video_call") {
    return await VideoCall.findById(referencedId)
      .populate("callerId", "displayName avatar")
      .populate("receiverId", "displayName avatar")
      .select("callerId receiverId status callType createdAt");
  }

  return null;
}

function normalizeNotification(notification, referencedDoc) {
  const sender = notification.senderId || null;
  const referencedId =
    referencedDoc?._id?.toString?.() ||
    notification.referenced?.toString?.() ||
    null;

  let targetUrl = null;
  if (
    notification.type === "post_like" ||
    notification.type === "post_comment"
  ) {
    targetUrl = referencedId ? `/posts/${referencedId}` : null;
  } else if (
    notification.type === "reel_like" ||
    notification.type === "reel_comment"
  ) {
    targetUrl = referencedId ? `/reels?id=${referencedId}` : "/reels";
  } else if (
    notification.type === "story_react" ||
    notification.type === "story_reply"
  ) {
    targetUrl = "/blog";
  } else if (notification.type === "friend_request") {
    targetUrl = referencedId
      ? `/friends/requests/${referencedId}`
      : "/friends/requests";
  } else if (notification.type === "video_call") {
    targetUrl = referencedId ? `/calls/${referencedId}` : null;
  } else if (notification.type === "group_invite") {
    targetUrl = referencedId ? `/chat/conversations/${referencedId}` : null;
  } else if (notification.type === "group_member_request") {
    const conversationId =
      notification?.metadata?.conversationId || referencedId || null;
    targetUrl = conversationId ? `/messages/${conversationId}` : null;
  } else if (notification.type === "mention") {
    const conversationId =
      notification?.metadata?.conversationId || referencedId || null;
    targetUrl = conversationId ? `/messages/${conversationId}` : null;
  }

  return {
    ...notification.toObject(),
    senderName: sender?.displayName || null,
    senderAvatar: sender?.avatar || null,
    displayText: getNotificationTypeLabel(notification.type),
    previewImage: pickPreviewImage(notification, referencedDoc),
    targetUrl,
    referenced: referencedDoc || notification.referenced || null,
  };
}

class NotificationService {
  /**
   * Lấy danh sách thông báo
   */
  async getNotifications(userId) {
    const notis = await Notification.find({ recipientId: userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("senderId", "displayName avatar")
      .lean(false);

    const notifications = await Promise.all(
      notis.map(async (notification) => {
        const referencedDoc = await hydrateReferenced(notification);
        return normalizeNotification(notification, referencedDoc);
      }),
    );

    return {
      notifications,
      total: notifications.length,
    };
  }

  /**
   * Đánh dấu đã đọc
   */
  async markAsRead(notificationId) {
    await Notification.findByIdAndUpdate(notificationId, { isRead: true });
    return { success: true };
  }

  /**
   * Đánh dấu tất cả đã đọc
   */
  async markAllAsRead(userId) {
    await Notification.updateMany(
      { recipientId: userId, isRead: false },
      { isRead: true },
    );
    return { success: true };
  }

  /**
   * Xóa thông báo
   */
  async deleteNotification(userId, notificationId) {
    await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: userId,
    });
    return { success: true };
  }
}

module.exports = new NotificationService();
