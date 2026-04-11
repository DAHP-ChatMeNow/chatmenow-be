const { Worker } = require("bullmq");
const aiSummaryService = require("../api/service/ai-summary.service");
const { getRedisClient, isRedisEnabled } = require("../config/redis");
const { QUEUE_NAME } = require("../queues/ai-summary.queue");

let worker = null;

function startAiSummaryWorker() {
  if (!isRedisEnabled() || worker) {
    return worker;
  }

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const userId = String(job.data?.userId || "");
      const conversationId = String(job.data?.conversationId || "");

      if (!userId || !conversationId) {
        throw new Error("Missing warmup job payload");
      }

      return await aiSummaryService.getUnreadSummary(userId, conversationId, {
        forceRefresh: true,
      });
    },
    {
      connection: getRedisClient(),
      concurrency: Number.parseInt(process.env.AI_SUMMARY_WORKER_CONCURRENCY || "2", 10),
    },
  );

  worker.on("completed", (job) => {
    console.log(`[AI Summary] Warmup completed job=${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.warn(
      `[AI Summary] Warmup failed job=${job?.id || "unknown"}: ${error?.message || "unknown error"}`,
    );
  });

  return worker;
}

async function stopAiSummaryWorker() {
  if (!worker) {
    return;
  }

  const current = worker;
  worker = null;
  await current.close();
}

module.exports = {
  startAiSummaryWorker,
  stopAiSummaryWorker,
};
