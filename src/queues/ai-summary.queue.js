const { Queue } = require("bullmq");
const { getRedisClient, isRedisEnabled } = require("../config/redis");

const QUEUE_NAME = "ai-summary-warmup";
let aiSummaryQueue = null;

function getAiSummaryQueue() {
  if (!isRedisEnabled()) {
    return null;
  }

  if (!aiSummaryQueue) {
    aiSummaryQueue = new Queue(QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 500,
        removeOnFail: 200,
        attempts: 1,
      },
    });
  }

  return aiSummaryQueue;
}

async function warmupUnreadSummary({ userId, conversationId }) {
  const queue = getAiSummaryQueue();
  if (!queue) {
    return null;
  }

  return await queue.add(
    "warmup",
    {
      userId: String(userId),
      conversationId: String(conversationId),
    },
    {
      jobId: `warmup:${conversationId}:${userId}:${Date.now()}`,
    },
  );
}

module.exports = {
  QUEUE_NAME,
  getAiSummaryQueue,
  warmupUnreadSummary,
};
