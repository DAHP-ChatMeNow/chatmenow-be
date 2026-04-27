const Reel = require("../models/reel.model");
const ReelLike = require("../models/reel-like.model");
const ReelComment = require("../models/reel-comment.model");
const Notification = require("../models/notification.model");
const { getSignedUrlFromS3 } = require("../middleware/storage");
const { REEL_LIMITS } = require("../../constants/reel.constants");
const premiumService = require("./premium.service");

class ReelService {
    // ─── helpers ────────────────────────────────────────────────────────────────

    async resolveReelVideoUrl(reel) {
        if (!reel.videoUrl) return reel;
        if (reel.videoUrl.startsWith("http")) return reel;

        try {
            const signedUrl = await getSignedUrlFromS3(reel.videoUrl);
            return { ...reel, videoUrl: signedUrl };
        } catch {
            return reel;
        }
    }

    parseHashtags(caption = "") {
        const tags = caption.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g) || [];
        return [...new Set(tags.map((t) => t.toLowerCase()))].slice(
            0,
            REEL_LIMITS.MAX_HASHTAGS,
        );
    }

    // ─── create ─────────────────────────────────────────────────────────────────

    async createReel(
        userId,
        {
            caption = "",
            musicUrl = null,
            musicTitle = null,
            musicArtist = null,
            videoDuration = 0,
        },
        s3Key,
    ) {
        if (!s3Key) {
            throw { statusCode: 400, message: "Video URL là bắt buộc" };
        }

        if (caption.length > REEL_LIMITS.MAX_CAPTION_LENGTH) {
            throw { statusCode: 400, message: "Caption quá dài" };
        }

        await premiumService.enforceReelCreation(userId, {
            videoDuration: Number(videoDuration || 0),
        });

        const hashtags = this.parseHashtags(caption);

        const reel = await Reel.create({
            userId,
            videoUrl: s3Key,
            duration: Number(videoDuration || 0),
            caption,
            hashtags,
            musicUrl: musicUrl || null,
            musicTitle: musicTitle || null,
            musicArtist: musicArtist || null,
        });

        await reel.populate("userId", "displayName avatar");

        const reelObj = reel.toObject();
        return this.resolveReelVideoUrl({ ...reelObj, isLikedByCurrentUser: false });
    }

    // ─── feed ────────────────────────────────────────────────────────────────────

    async getReelFeed(userId, { cursor, limit = REEL_LIMITS.FEED_PAGE_SIZE } = {}) {
        const query = { isDeleted: false };
        if (cursor) {
            query.createdAt = { $lt: new Date(cursor) };
        }

        const reels = await Reel.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .populate("userId", "displayName avatar");

        const hasMore = reels.length > limit;
        const sliced = hasMore ? reels.slice(0, limit) : reels;

        // Batch-check likes for current user
        const reelIds = sliced.map((r) => r._id);
        const likedSet = new Set(
            (
                await ReelLike.find({ reelId: { $in: reelIds }, userId }).select("reelId")
            ).map((l) => l.reelId.toString()),
        );

        const resolved = await Promise.all(
            sliced.map(async (reel) => {
                const obj = reel.toObject();
                return this.resolveReelVideoUrl({
                    ...obj,
                    isLikedByCurrentUser: likedSet.has(obj._id.toString()),
                });
            }),
        );

        const nextCursor =
            hasMore ? sliced[sliced.length - 1].createdAt.toISOString() : null;

        return { reels: resolved, hasMore, nextCursor };
    }

    // ─── single reel ────────────────────────────────────────────────────────────

    async getReelById(userId, reelId) {
        const reel = await Reel.findOne({ _id: reelId, isDeleted: false }).populate(
            "userId",
            "displayName avatar",
        );

        if (!reel) {
            throw { statusCode: 404, message: "Reel không tồn tại" };
        }

        const liked = !!(await ReelLike.findOne({ reelId, userId }));
        const obj = reel.toObject();
        return this.resolveReelVideoUrl({ ...obj, isLikedByCurrentUser: liked });
    }

    // ─── my reels ────────────────────────────────────────────────────────────────

    async getMyReels(userId, { cursor, limit = REEL_LIMITS.FEED_PAGE_SIZE } = {}) {
        const query = { userId, isDeleted: false };
        if (cursor) {
            query.createdAt = { $lt: new Date(cursor) };
        }

        const reels = await Reel.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .populate("userId", "displayName avatar");

        const hasMore = reels.length > limit;
        const sliced = hasMore ? reels.slice(0, limit) : reels;

        const reelIds = sliced.map((r) => r._id);
        const likedSet = new Set(
            (
                await ReelLike.find({ reelId: { $in: reelIds }, userId }).select("reelId")
            ).map((l) => l.reelId.toString()),
        );

        const resolved = await Promise.all(
            sliced.map(async (reel) => {
                const obj = reel.toObject();
                return this.resolveReelVideoUrl({
                    ...obj,
                    isLikedByCurrentUser: likedSet.has(obj._id.toString()),
                });
            }),
        );

        const nextCursor =
            hasMore ? sliced[sliced.length - 1].createdAt.toISOString() : null;

        return { reels: resolved, hasMore, nextCursor };
    }

    // ─── like/unlike ─────────────────────────────────────────────────────────────

    async toggleLike(userId, reelId) {
        const reel = await Reel.findOne({ _id: reelId, isDeleted: false });
        if (!reel) {
            throw { statusCode: 404, message: "Reel không tồn tại" };
        }

        const existing = await ReelLike.findOne({ reelId, userId });

        if (existing) {
            await ReelLike.deleteOne({ _id: existing._id });
            await Reel.findByIdAndUpdate(reelId, { $inc: { likeCount: -1 } });
            return { liked: false, likeCount: Math.max(0, reel.likeCount - 1) };
        } else {
            await premiumService.enforceInteraction(userId);
            await ReelLike.create({ reelId, userId });
            await Reel.findByIdAndUpdate(reelId, { $inc: { likeCount: 1 } });

            if (reel.userId.toString() !== userId.toString()) {
                await Notification.create({
                    type: "reel_like",
                    recipientId: reel.userId,
                    senderId: userId,
                    referenced: reel._id,
                    isRead: false
                });
            }

            return { liked: true, likeCount: reel.likeCount + 1 };
        }
    }

    // ─── comments ───────────────────────────────────────────────────────────────

    async addComment(userId, reelId, { content, replyToCommentId = null }) {
        const reel = await Reel.findOne({ _id: reelId, isDeleted: false });
        if (!reel) {
            throw { statusCode: 404, message: "Reel không tồn tại" };
        }

        if (!content || !content.trim()) {
            throw { statusCode: 400, message: "Nội dung comment không được trống" };
        }

        await premiumService.enforceInteraction(userId);

        const comment = await ReelComment.create({
            reelId,
            userId,
            content: content.trim(),
            replyToCommentId: replyToCommentId || null,
        });

        await Reel.findByIdAndUpdate(reelId, { $inc: { commentCount: 1 } });
        await comment.populate("userId", "displayName avatar");

        if (reel.userId.toString() !== userId.toString()) {
            await Notification.create({
                type: "reel_comment",
                recipientId: reel.userId,
                senderId: userId,
                referenced: reel._id,
                metadata: { commentId: comment._id },
                isRead: false
            });
        }

        return comment.toObject();
    }

    async getComments(reelId, { cursor, limit = REEL_LIMITS.COMMENTS_PAGE_SIZE } = {}) {
        const reel = await Reel.findOne({ _id: reelId, isDeleted: false });
        if (!reel) {
            throw { statusCode: 404, message: "Reel không tồn tại" };
        }

        const query = { reelId, isDeleted: false };
        if (cursor) {
            query.createdAt = { $gt: new Date(cursor) };
        }

        const comments = await ReelComment.find(query)
            .sort({ createdAt: 1 })
            .limit(limit + 1)
            .populate("userId", "displayName avatar");

        const hasMore = comments.length > limit;
        const sliced = hasMore ? comments.slice(0, limit) : comments;

        const nextCursor =
            hasMore ? sliced[sliced.length - 1].createdAt.toISOString() : null;

        return {
            comments: sliced.map((c) => c.toObject()),
            hasMore,
            nextCursor,
        };
    }

    // ─── delete ─────────────────────────────────────────────────────────────────

    async deleteReel(userId, reelId) {
        const reel = await Reel.findOne({ _id: reelId, isDeleted: false });
        if (!reel) {
            throw { statusCode: 404, message: "Reel không tồn tại" };
        }
        if (reel.userId.toString() !== userId.toString()) {
            throw { statusCode: 403, message: "Bạn không có quyền xóa reel này" };
        }

        await Reel.findByIdAndUpdate(reelId, {
            isDeleted: true,
            deletedAt: new Date(),
        });

        return { success: true, message: "Đã xóa reel" };
    }

    // ─── increment view ──────────────────────────────────────────────────────────

    async incrementView(reelId) {
        await Reel.findByIdAndUpdate(reelId, { $inc: { viewCount: 1 } });
        return { success: true };
    }
}

module.exports = new ReelService();
