const Redis = require("ioredis");

let redisClient = null;

function getRedisUrl() {
  return String(process.env.REDIS_URL || process.env.REDIS_HOST || "").trim();
}

function isRedisEnabled() {
  return Boolean(getRedisUrl());
}

function getRedisClient() {
  if (!isRedisEnabled()) {
    return null;
  }

  if (!redisClient) {
    const redisUrl = getRedisUrl();

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || "5000", 10),
    });

    redisClient.on("error", (error) => {
      console.warn(`[Redis] ${error?.message || "unknown error"}`);
    });
  }

  return redisClient;
}

async function closeRedisClient() {
  if (!redisClient) {
    return;
  }

  const client = redisClient;
  redisClient = null;

  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

module.exports = {
  getRedisClient,
  isRedisEnabled,
  closeRedisClient,
};
