const Reel = require("../models/reel.model");
const ReelLike = require("../models/reel-like.model");
const { uploadToS3, getSignedUrlFromS3 } = require("../middleware/storage");

// ─── Trending score weights ───────────────────────────────────────────────────
const W_LIKE    = 3;
const W_COMMENT = 2;
const W_SHARE   = 2;
const W_VIEW    = 0.5;
const DECAY_BASE = 1.8; // gravity for time decay (hours)

/**
 * Compute a simple trending score based on engagement + time decay.
 * score = (likes*3 + comments*2 + shares*2 + views*0.5) / (ageHours + 2)^1.8
 */
function computeTrendingScore(stats, createdAt) {
  const ageMs    = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const rawScore =
    stats.likesCount    * W_LIKE   +
    stats.commentsCount * W_COMMENT +
    stats.sharesCount   * W_SHARE  +
    stats.viewsCount    * W_VIEW;
  return rawScore / Math.pow(ageHours + 2, DECAY_BASE);
}

class ReelService {
  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Resolve S3 key → presigned URL for videoUrl and thumbnail.
   * If the value already starts with "http" it is returned as-is.
   */
  async _resolveReelUrls(reelObj) {
    const resolve = async (key) => {
      if (!key || key.startsWith("http")) return key;
      try {
        return await getSignedUrlFromS3(key);
      } catch {
        return key;
      }
    };

    return {
      ...reelObj,
      videoUrl:  await resolve(reelObj.videoUrl),
      thumbnail: reelObj.thumbnail ? await resolve(reelObj.thumbnail) : null,
    };
  }

  /**
   * Check if a user has liked a reel.
   */
  async _isLikedByUser(reelId, userId) {
    if (!userId) return false;
    const like = await ReelLike.exists({ reelId, userId });
    return !!like;
  }

  /**
   * Map a Mongoose Reel document (or plain object) into the API shape.
   */
  async _toDTO(reelDoc, userId = null) {
    const obj = reelDoc.toObject ? reelDoc.toObject() : { ...reelDoc };

    // Flatten authorId populate to "author"
    const author = obj.authorId;

    const dto = {
      id:        obj._id,
      _id:       obj._id,
      authorId:  author?._id || author,
      author:    author || null,
      videoUrl:  obj.videoUrl,
      thumbnail: obj.thumbnail,
      caption:   obj.caption,
      duration:  obj.duration,
      privacy:   obj.privacy,
      stats:     obj.stats,
      ranking:   obj.ranking,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
      // Convenience top-level alias (compatible with FE Post shape)
      likesCount:    obj.stats?.likesCount    ?? 0,
      commentsCount: obj.stats?.commentsCount ?? 0,
      viewsCount:    obj.stats?.viewsCount    ?? 0,
      isLikedByCurrentUser: false,
    };

    // Resolve presigned URLs
    const resolved = await this._resolveReelUrls(dto);

    // Set like flag if userId provided
    if (userId) {
      resolved.isLikedByCurrentUser = await this._isLikedByUser(obj._id, userId);
    }

    return resolved;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Create a new reel.
   * @param {string}  userId   - Authenticated user ID (from JWT)
   * @param {object}  payload  - { caption, privacy, duration }
   * @param {object}  file     - Multer file object for the video
   */
  async createReel(userId, payload, file) {
    if (!file) {
      throw { statusCode: 400, message: "File video là bắt buộc" };
    }

    // Validate duration
    const duration = payload.duration ? parseFloat(payload.duration) : 0;
    if (duration > 90) {
      throw { statusCode: 400, message: "Reel chỉ hỗ trợ video tối đa 90 giây" };
    }

    // Upload video to S3
    const videoKey = await uploadToS3(file, "reels");

    const reel = await Reel.create({
      authorId:  userId,
      videoUrl:  videoKey,
      thumbnail: payload.thumbnail || null,
      caption:   payload.caption   || "",
      duration,
      privacy:   payload.privacy   || "public",
    });

    const populated = await reel.populate("authorId", "displayName avatar");
    return this._toDTO(populated, userId);
  }

  /**
   * Delete a reel (owner only).
   */
  async deleteReel(userId, reelId) {
    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw { statusCode: 404, message: "Reel không tồn tại" };
    }
    if (reel.authorId.toString() !== userId.toString()) {
      throw { statusCode: 403, message: "Bạn không có quyền xoá reel này" };
    }

    await Reel.deleteOne({ _id: reelId });
    // Remove all likes for this reel
    await ReelLike.deleteMany({ reelId });

    return { message: "Đã xoá reel" };
  }

  /**
   * Like a reel.
   * Returns early (idempotent) if already liked.
   */
  async likeReel(userId, reelId) {
    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw { statusCode: 404, message: "Reel không tồn tại" };
    }

    // Upsert-style: insertOne + catch duplicate-key error
    try {
      await ReelLike.create({ reelId, userId });
    } catch (err) {
      if (err.code === 11000) {
        // Already liked → treat as success (idempotent)
        return { isLikedByCurrentUser: true, likesCount: reel.stats.likesCount };
      }
      throw err;
    }

    // Increment counter
    const updated = await Reel.findByIdAndUpdate(
      reelId,
      { $inc: { "stats.likesCount": 1 } },
      { new: true }
    );

    // Recompute trending score
    const newScore = computeTrendingScore(updated.stats, updated.createdAt);
    await Reel.updateOne({ _id: reelId }, { "ranking.trendingScore": newScore });

    return {
      isLikedByCurrentUser: true,
      likesCount: updated.stats.likesCount,
    };
  }

  /**
   * Unlike a reel.
   * Returns early (idempotent) if not liked.
   */
  async unlikeReel(userId, reelId) {
    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw { statusCode: 404, message: "Reel không tồn tại" };
    }

    const result = await ReelLike.deleteOne({ reelId, userId });
    if (result.deletedCount === 0) {
      // Not liked → idempotent
      return { isLikedByCurrentUser: false, likesCount: reel.stats.likesCount };
    }

    const updated = await Reel.findByIdAndUpdate(
      reelId,
      { $inc: { "stats.likesCount": -1 } },
      { new: true }
    );

    // Guard against going negative (race condition safety)
    if (updated.stats.likesCount < 0) {
      await Reel.updateOne({ _id: reelId }, { "stats.likesCount": 0 });
      updated.stats.likesCount = 0;
    }

    // Recompute trending score
    const newScore = computeTrendingScore(updated.stats, updated.createdAt);
    await Reel.updateOne({ _id: reelId }, { "ranking.trendingScore": newScore });

    return {
      isLikedByCurrentUser: false,
      likesCount: updated.stats.likesCount,
    };
  }

  /**
   * Record a view for a reel.
   * Accepts optional watchSeconds to update watch-time analytics.
   */
  async addView(reelId, watchSeconds = 0) {
    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw { statusCode: 404, message: "Reel không tồn tại" };
    }

    const updatePayload = {
      $inc: {
        "stats.viewsCount":       1,
        "ranking.watchTimeTotal": watchSeconds,
      },
    };

    const updated = await Reel.findByIdAndUpdate(reelId, updatePayload, { new: true });

    // Update avgWatchPercent
    if (reel.duration && reel.duration > 0) {
      const totalViews  = updated.stats.viewsCount;
      const totalWatch  = updated.ranking.watchTimeTotal;
      const avgPercent  = Math.min(100, (totalWatch / totalViews / reel.duration) * 100);

      await Reel.updateOne(
        { _id: reelId },
        { "ranking.avgWatchPercent": Math.round(avgPercent * 10) / 10 }
      );
    }

    // Recompute trending score
    const freshReel = await Reel.findById(reelId);
    const newScore  = computeTrendingScore(freshReel.stats, freshReel.createdAt);
    await Reel.updateOne({ _id: reelId }, { "ranking.trendingScore": newScore });

    return { viewsCount: updated.stats.viewsCount };
  }

  /**
   * Get all reels by a specific user (newest first).
   */
  async getUserReels(targetUserId, requestingUserId) {
    const reels = await Reel.find({ authorId: targetUserId, privacy: "public" })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("authorId", "displayName avatar");

    const dtos = await Promise.all(
      reels.map((r) => this._toDTO(r, requestingUserId))
    );
    return dtos;
  }

  /**
   * Cursor-based feed – sorted by trendingScore desc, _id desc.
   * Limit: 20 per page.
   *
   * cursor encodes the last reel seen as JSON: { score, id }
   * e.g. cursor = btoa(JSON.stringify({ score: 12.5, id: "64abc..." }))
   */
  async getReelFeed(cursor, userId) {
    const LIMIT = 20;
    const query = { privacy: "public" };

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
        const { score, id } = decoded;
        // Fetch reels with lower trendingScore, OR same score but earlier _id
        query.$or = [
          { "ranking.trendingScore": { $lt: score } },
          { "ranking.trendingScore": score, _id: { $lt: id } },
        ];
      } catch {
        // Invalid cursor → start from beginning
      }
    }

    const reels = await Reel.find(query)
      .sort({ "ranking.trendingScore": -1, _id: -1 })
      .limit(LIMIT + 1) // fetch one extra to determine hasMore
      .populate("authorId", "displayName avatar");

    const hasMore = reels.length > LIMIT;
    const items   = hasMore ? reels.slice(0, LIMIT) : reels;

    // Build next cursor from the last item returned
    let nextCursor = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ score: last.ranking.trendingScore, id: last._id.toString() })
      ).toString("base64");
    }

    const dtos = await Promise.all(items.map((r) => this._toDTO(r, userId)));

    return { reels: dtos, nextCursor, hasMore };
  }
}

module.exports = new ReelService();
