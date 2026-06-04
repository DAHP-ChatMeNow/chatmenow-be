/**
 * In-memory rate limiter middleware.
 *
 * Uses a Map with periodic cleanup — consistent with how the OTP service
 * manages state in this project. For horizontal scaling, swap to Redis.
 *
 * Usage:
 *   const { createRateLimiter } = require("./rateLimiter");
 *   router.post("/forgot-password", createRateLimiter({ ... }), controller);
 */

const CLEANUP_INTERVAL_MS = 60 * 1000; // Purge expired entries every 60s

/**
 * Creates an Express rate-limiting middleware.
 *
 * @param {Object} options
 * @param {number}   options.windowMs     - Time window in milliseconds
 * @param {number}   options.maxRequests  - Max requests allowed within the window
 * @param {Function} options.keyFn        - (req) => string — extracts the rate-limit key
 * @param {string}   [options.message]    - Custom 429 response message
 * @returns {Function} Express middleware
 */
function createRateLimiter({
  windowMs,
  maxRequests,
  keyFn,
  message = "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
}) {
  const store = new Map();

  // Periodic cleanup to prevent memory leaks
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.windowStart >= windowMs) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the timer to not block Node.js shutdown
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return (req, res, next) => {
    const key = keyFn(req);
    if (!key) {
      return next();
    }

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      // First request or window expired — start fresh
      store.set(key, { windowStart: now, count: 1 });
      return next();
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.ceil(
        (windowMs - (now - entry.windowStart)) / 1000,
      );
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
