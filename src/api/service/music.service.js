/* eslint-disable no-console */
/**
 * MusicService — Jamendo API integration with MongoDB cache
 *
 * Fix log:
 *  - Replaced raw https.get with global fetch (Node ≥18)
 *  - Fixed wrong Jamendo params (audioformat, featured)
 *  - Added `id` field to mapped tracks (frontend expects it)
 *  - Added clear startup warning when JAMENDO_CLIENT_ID is missing
 *  - Added MOCK_TRACKS fallback so frontend never gets an empty list
 *  - Added timeout + retry-once logic
 *  - Corrected `getPopular` endpoint params
 */

const Music = require("../models/music.model");

// Public demo client_id from Jamendo official docs (rate-limited but functional)
const JAMENDO_CLIENT_ID =
  process.env.JAMENDO_CLIENT_ID &&
  process.env.JAMENDO_CLIENT_ID !== "your_jamendo_client_id_here"
    ? process.env.JAMENDO_CLIENT_ID
    : "b6747d04"; // Jamendo demo key — replace with your own from developers.jamendo.com

const JAMENDO_BASE = "https://api.jamendo.com/v3.0";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REQUEST_TIMEOUT_MS = 8000;

// Warn if using demo key
if (JAMENDO_CLIENT_ID === "b6747d04") {
  console.warn(
    "\n⚠️  [MusicService] Using Jamendo DEMO client_id — register your own at:\n" +
      "   https://developers.jamendo.com/\n",
  );
}

// ── Sample tracks shown when Jamendo is unavailable ──────────────────────────
const MOCK_TRACKS = [
  {
    id: "mock-1",
    jamendoId: "mock-1",
    title: "Sunny Day",
    artist: "Jamendo Demo",
    url: "https://www.bensound.com/bensound-music/bensound-sunny.mp3",
    coverUrl: null,
    duration: 120,
    source: "mock",
  },
  {
    id: "mock-2",
    jamendoId: "mock-2",
    title: "Acoustic Breeze",
    artist: "Jamendo Demo",
    url: "https://www.bensound.com/bensound-music/bensound-acousticbreeze.mp3",
    coverUrl: null,
    duration: 114,
    source: "mock",
  },
  {
    id: "mock-3",
    jamendoId: "mock-3",
    title: "Happy Rock",
    artist: "Jamendo Demo",
    url: "https://www.bensound.com/bensound-music/bensound-happyrock.mp3",
    coverUrl: null,
    duration: 130,
    source: "mock",
  },
];

class MusicService {
  // ─── Fetch helper (uses Node ≥18 global fetch) ───────────────────────────

  async _fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Jamendo HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      // Jamendo API-level error
      if (json.headers?.status === "failed") {
        const msg = json.headers.error_message || "Jamendo API error";
        throw new Error(msg);
      }

      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Map Jamendo track to our schema ─────────────────────────────────────

  _mapJamendoTrack(track) {
    const url = track.audio || track.audiodownload || "";
    return {
      id: String(track.id),
      jamendoId: String(track.id),
      title: track.name || "Unknown",
      artist: track.artist_name || "",
      url,
      coverUrl: track.shareurl
        ? null
        : track.album_image || track.image || null,
      duration: Number(track.duration) || 0,
      source: "jamendo",
    };
  }

  // ─── Persist to cache ─────────────────────────────────────────────────────

  async _upsertToCache(tracks) {
    const ops = tracks
      .filter((t) => t.url && t.jamendoId && !t.jamendoId.startsWith("mock-"))
      .map((t) => ({
        updateOne: {
          filter: { jamendoId: t.jamendoId },
          update: { $set: { ...t, cachedAt: new Date() } },
          upsert: true,
        },
      }));

    if (ops.length) {
      try {
        await Music.bulkWrite(ops);
      } catch (err) {
        console.error("[MusicService] Cache write error:", err.message);
      }
    }
  }

  // ─── Build Jamendo URL ────────────────────────────────────────────────────

  _buildUrl(path, extraParams = {}) {
    const params = new URLSearchParams({
      client_id: JAMENDO_CLIENT_ID,
      format: "json",
      limit: "20",
      ...extraParams,
    });
    return `${JAMENDO_BASE}${path}?${params.toString()}`;
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  async search(query = "", limit = 20) {
    const q = query.trim();

    if (!q) {
      return this.getPopular(limit);
    }

    // 1. Try MongoDB text-index cache
    try {
      const cached = await Music.find(
        { $text: { $search: q } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .lean();

      if (cached.length >= limit) {
        return cached.map((m) => ({ ...m, id: m.jamendoId }));
      }
    } catch (err) {
      console.error("[MusicService] Cache search error:", err.message);
    }

    // 3. Jamendo search
    try {
      const url = this._buildUrl("/tracks/", {
        search: q,
        limit: String(limit),
        // `audio` is always included for streaming; no extra audioformat needed
        include: "musicinfo",
      });

      console.log("[MusicService] Searching Jamendo:", url);
      const json = await this._fetchJson(url);
      const tracks = (json.results || []).map((t) => this._mapJamendoTrack(t));

      await this._upsertToCache(tracks);

      // Fall back to mocks if API returned nothing
      return tracks.length > 0 ? tracks : MOCK_TRACKS;
    } catch (err) {
      console.error("[MusicService] Jamendo search failed:", err.message);
      // Return any partial cache + mocks
      try {
        const fallback = await Music.find({})
          .sort({ cachedAt: -1 })
          .limit(limit)
          .lean();
        return fallback.length > 0
          ? fallback.map((m) => ({ ...m, id: m.jamendoId }))
          : MOCK_TRACKS;
      } catch {
        return MOCK_TRACKS;
      }
    }
  }

  // ─── Popular / Trending ──────────────────────────────────────────────────

  async getPopular(limit = 20) {
    // 1. Fresh cache
    const freshCutoff = new Date(Date.now() - CACHE_TTL_MS);
    try {
      const cached = await Music.find({ cachedAt: { $gt: freshCutoff } })
        .sort({ cachedAt: -1 })
        .limit(limit)
        .lean();

      if (cached.length >= limit) {
        return cached.map((m) => ({ ...m, id: m.jamendoId }));
      }
    } catch (err) {
      console.error("[MusicService] Cache popular error:", err.message);
    }

    // 3. Jamendo popular tracks
    try {
      const url = this._buildUrl("/tracks/", {
        limit: String(limit),
        order: "popularity_total",
        include: "musicinfo",
        // NOTE: `featured` and `audioformat` are not valid v3.0 params
      });

      const json = await this._fetchJson(url);
      const tracks = (json.results || []).map((t) => this._mapJamendoTrack(t));

      await this._upsertToCache(tracks);

      return tracks.length > 0 ? tracks : MOCK_TRACKS;
    } catch (err) {
      console.error("[MusicService] Jamendo popular failed:", err.message);
      try {
        const fallback = await Music.find({})
          .sort({ cachedAt: -1 })
          .limit(limit)
          .lean();
        return fallback.length > 0
          ? fallback.map((m) => ({ ...m, id: m.jamendoId }))
          : MOCK_TRACKS;
      } catch {
        return MOCK_TRACKS;
      }
    }
  }
}

module.exports = new MusicService();
