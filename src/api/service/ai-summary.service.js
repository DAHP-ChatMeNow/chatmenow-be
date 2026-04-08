const mongoose = require("mongoose");
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const AiSummaryRecord = require("../models/ai-summary-record.model");
const AiUsageDaily = require("../models/ai-usage-daily.model");
const AiSummaryMessageState = require("../models/ai-summary-message-state.model");
const { getRedisClient, isRedisEnabled } = require("../../config/redis");
const aiService = require("./ai.service");

class AiSummaryService {
  constructor() {
    this.bedrockClient = null;
    this.redisClient = null;
    this.memoryCache = new Map();
    this.aiService = aiService;
  }

  parseBoolean(value, fallback = false) {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value || "")
      .trim()
      .toLowerCase();

    if (!normalized) {
      return fallback;
    }

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  getConfig() {
    return {
      assistantName: String(process.env.AI_SUMMARY_ASSISTANT_NAME || "DanhAI"),
      modelId: String(process.env.AI_SUMMARY_BEDROCK_MODEL_ID || "").trim(),
      region: String(process.env.AI_SUMMARY_BEDROCK_REGION || process.env.AWS_REGION || "ap-southeast-1").trim(),
      maxMessages: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_MAX_MESSAGES || "120", 10), 20),
        300,
      ),
      minUnreadThreshold: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_MIN_UNREAD || "10", 10), 1),
        100,
      ),
      cacheTtlMinutes: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_CACHE_TTL_MIN || "15", 10), 1),
        240,
      ),
      maxSummaryRequestsPerDay: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_MAX_REQUESTS_PER_DAY || "80", 10), 1),
        1000,
      ),
      maxUsdPerUserPerDay: Math.max(
        Number.parseFloat(process.env.AI_SUMMARY_MAX_USD_PER_USER_PER_DAY || "1"),
        0.01,
      ),
      maxInputCharsPerMessage: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_MAX_CHARS_PER_MESSAGE || "120", 10), 80),
        800,
      ),
      timeoutMs: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_TIMEOUT_MS || "8000", 10), 2000),
        30000,
      ),
      maxTokens: Math.min(
        Math.max(Number.parseInt(process.env.AI_SUMMARY_MAX_OUTPUT_TOKENS || "320", 10), 80),
        1024,
      ),
      anthropicVersion: "bedrock-2023-05-31",
      estimatedInputPerMillion: Math.max(
        Number.parseFloat(process.env.AI_SUMMARY_INPUT_PRICE_PER_MILLION || "1.0"),
        0,
      ),
      estimatedOutputPerMillion: Math.max(
        Number.parseFloat(process.env.AI_SUMMARY_OUTPUT_PRICE_PER_MILLION || "5.0"),
        0,
      ),
      debug: this.parseBoolean(process.env.AI_SUMMARY_DEBUG, false),
    };
  }

  sanitizeMessageContent(text, maxChars = 120) {
    return String(text || "")
      .replace(/\n\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  }

  formatMessageForAi(msg, maxChars) {
    const senderName = typeof msg.senderId === "object" 
      ? msg.senderId?.displayName || "User"
      : "User";
    const content = this.sanitizeMessageContent(msg.content, maxChars);
    return `${senderName}: ${content}`;
  }

  getClient(region) {
    if (!this.bedrockClient) {
      this.bedrockClient = new BedrockRuntimeClient({ region });
    }
    return this.bedrockClient;
  }

  getDayKey(inputDate = new Date()) {
    const d = new Date(inputDate);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async ensureGroupConversationMember(conversationId, userId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw { statusCode: 400, message: "conversationId không hợp lệ" };
    }

    const conversation = await Conversation.findById(conversationId)
      .select("_id type members.userId members.lastReadAt")
      .lean();

    if (!conversation) {
      throw { statusCode: 404, message: "Không tìm thấy cuộc trò chuyện" };
    }

    if (conversation.type !== "group") {
      throw { statusCode: 400, message: "Tính năng chỉ hỗ trợ group chat" };
    }

    const member = (conversation.members || []).find(
      (item) => String(item.userId) === String(userId),
    );

    if (!member) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền truy cập cuộc trò chuyện này",
      };
    }

    return { conversation, member };
  }

  buildFingerprint({ userId, conversationId, newestUnreadMessageId, unreadCount }) {
    return [
      String(userId),
      String(conversationId),
      String(newestUnreadMessageId || "none"),
      String(unreadCount || 0),
    ].join(":");
  }

  buildCacheKey({ userId, conversationId, fingerprint }) {
    return [String(userId), String(conversationId), String(fingerprint)].join(
      ":",
    );
  }

  normalizeMessageIds(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const unique = new Set();
    for (const value of values) {
      const id = String(value || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        continue;
      }
      unique.add(id);
    }

    return Array.from(unique);
  }

  async registerPendingMessages({
    conversationId,
    senderId,
    recipientIds,
    messageId,
    receivedAt,
  }) {
    if (!mongoose.Types.ObjectId.isValid(String(conversationId || ""))) {
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(String(messageId || ""))) {
      return;
    }

    const validRecipients = this.normalizeMessageIds(recipientIds).filter(
      (userId) => String(userId) !== String(senderId),
    );

    if (validRecipients.length === 0) {
      return;
    }

    const conversation = await Conversation.findById(conversationId)
      .select("_id type")
      .lean();

    if (!conversation || conversation.type !== "group") {
      return;
    }

    const now = receivedAt ? new Date(receivedAt) : new Date();

    const operations = validRecipients.map((userId) => ({
      updateOne: {
        filter: {
          userId,
          conversationId,
          messageId,
        },
        update: {
          $setOnInsert: {
            userId,
            conversationId,
            messageId,
            senderId,
            status: "pending",
            receivedAt: now,
          },
        },
        upsert: true,
      },
    }));

    if (operations.length > 0) {
      await AiSummaryMessageState.bulkWrite(operations, { ordered: false });
    }
  }

  async getPendingSummaryCandidates(userId, conversationId, { limit = 200 } = {}) {
    await this.ensureGroupConversationMember(conversationId, userId);

    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500);
    const pendingStates = await AiSummaryMessageState.find({
      userId,
      conversationId,
      status: "pending",
    })
      .sort({ receivedAt: 1, _id: 1 })
      .limit(safeLimit)
      .select("_id messageId receivedAt")
      .lean();

    if (pendingStates.length === 0) {
      return {
        totalPending: 0,
        messages: [],
      };
    }

    const messageIds = pendingStates.map((item) => item.messageId);
    const messages = await Message.find({
      _id: { $in: messageIds },
      deletedFor: { $ne: userId },
      isUnsent: { $ne: true },
      type: { $ne: "system" },
    })
      .select("_id content type createdAt senderId")
      .populate("senderId", "displayName avatar")
      .lean();

    const messageById = new Map(
      messages.map((message) => [String(message._id), message]),
    );

    const orderedMessages = pendingStates
      .map((state) => {
        const message = messageById.get(String(state.messageId));
        if (!message) {
          return null;
        }

        return {
          ...message,
          pendingStateId: state._id,
          pendingReceivedAt: state.receivedAt,
        };
      })
      .filter(Boolean);

    return {
      totalPending: orderedMessages.length,
      messages: orderedMessages,
    };
  }

  getRedisClient() {
    if (!isRedisEnabled()) {
      return null;
    }

    if (!this.redisClient) {
      this.redisClient = getRedisClient();
    }

    return this.redisClient;
  }

  async getRedisCachedSummary(cacheKey) {
    const client = this.getRedisClient();
    if (!client) {
      return null;
    }

    try {
      const raw = await client.get(cacheKey);
      if (!raw) {
        return null;
      }

      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async setRedisCachedSummary(cacheKey, value, ttlMinutes) {
    const client = this.getRedisClient();
    if (!client) {
      return;
    }

    try {
      await client.set(
        cacheKey,
        JSON.stringify(value),
        "EX",
        Math.max(60, ttlMinutes * 60),
      );
    } catch {
      // Ignore Redis failures and keep the in-memory fallback active.
    }
  }

  pruneExpiredCache(now = Date.now()) {
    for (const [key, entry] of this.memoryCache.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }
  }

  async getCachedSummary(cacheKey) {
    const redisValue = await this.getRedisCachedSummary(cacheKey);
    if (redisValue) {
      void this.setCachedSummary(cacheKey, redisValue, 15);
      return redisValue;
    }

    this.pruneExpiredCache();
    const entry = this.memoryCache.get(cacheKey);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(cacheKey);
      return null;
    }

    return entry.value;
  }

  async setCachedSummary(cacheKey, value, ttlMinutes) {
    const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
    this.memoryCache.set(cacheKey, {
      expiresAt,
      value,
    });

    await this.setRedisCachedSummary(cacheKey, value, ttlMinutes);
  }

  sanitizeMessageContent(content, maxChars) {
    return String(content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  }

  buildModelInput(messages, maxCharsPerMessage) {
    const lines = messages
      .filter((msg) => msg && msg.content && !msg.isUnsent && msg.type !== "system" && msg.content.trim().length > 3)
      .map((msg) => {
        const senderName = msg.senderId?.displayName || "Người dùng";
        const normalizedContent = this.sanitizeMessageContent(msg.content, maxCharsPerMessage);
        return `${senderName}: ${normalizedContent}`;
      })
      .filter(Boolean);
    
    console.log("[AiSummary] buildModelInput: prepared", lines.length, "messages (filtered noise)");
    return lines;
  }

  estimateTokensFromLines(lines) {
    const totalChars = lines.join("\n").length;
    return Math.ceil(totalChars / 4);
  }

  estimateCostUsd(inputTokens, outputTokens, config) {
    const inputCost = (inputTokens / 1_000_000) * config.estimatedInputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * config.estimatedOutputPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  safeParseSummary(text, requestId = "unknown") {
    const raw = String(text || "").trim();
    console.log(`[AiSummary][${requestId}] safeParseSummary input length: ${raw.length}`);
    
    // GUARDRAIL 1: Check if contains JSON
    if (!raw.includes("{")) {
      console.warn(`[AiSummary][${requestId}] ⚠️ No JSON detected in response → skip parse, use fallback`);
      return this.parseTextFallbackSummary(text);
    }
    
    try {
      return this.parseJsonResponse(text);
    } catch (e) {
      console.warn(`[AiSummary][${requestId}] parseJsonResponse failed: ${e.message}`);
      
      // Attempt 1: Extract JSON from text
      const jsonMatch = text.match(/\{[^{}]*\}/);
      if (jsonMatch) {
        console.log(`[AiSummary][${requestId}] 🔍 JSON match attempt 1 - extracted: ${jsonMatch[0].slice(0, 80)}`);
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log(`[AiSummary][${requestId}] ✅ Repair attempt 1 SUCCESS`);
          return {
            overview: String(parsed?.overview || "").slice(0, 300),
          };
        } catch (e2) {
          console.warn(`[AiSummary][${requestId}] Repair attempt 1 failed: ${e2.message}`);
        }
      }

      // Attempt 2: Fix common JSON errors
      console.log(`[AiSummary][${requestId}] 🔧 Attempting repair 2: fix JSON syntax`);
      const fixedJson = text
        .replace(/'/g, '"')
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/([\w]+):/g, '"$1":');
      
      try {
        const parsed = JSON.parse(fixedJson);
        console.log(`[AiSummary][${requestId}] ✅ Repair attempt 2 SUCCESS`);
        return {
          overview: String(parsed?.overview || "").slice(0, 300),
        };
      } catch (e3) {
        console.warn(`[AiSummary][${requestId}] Repair attempt 2 failed: ${e3.message}`);
      }

      // Fallback: use text content
      console.warn(`[AiSummary][${requestId}] ❌ All JSON repairs failed, using text fallback`);
      return this.parseTextFallbackSummary(text);
    }
  }

  parseJsonResponse(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      throw new Error("AI response empty");
    }

    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("No valid JSON braces found");
    }
    
    const candidate = raw.slice(firstBrace, lastBrace + 1);

    try {
      const parsed = JSON.parse(candidate);
      return {
        overview: String(parsed?.overview || "").slice(0, 300),
      };
    } catch (err) {
      console.error("[AiSummary] JSON.parse error:", err.message);
      console.error("[AiSummary] Attempted to parse:", candidate.slice(0, 150));
      throw err;
    }
  }

  parseTextFallbackSummary(text) {
    const raw = String(text || "").trim();
    const overview = raw.slice(0, 300) || "DanhAI chưa phân tích được tóm tắt.";

    return {
      overview,
    };
  }

  formatBedrockError(error) {
    const details = {
      name: String(error?.name || "BedrockError"),
      code: String(error?.code || error?.Code || "UNKNOWN"),
      message: String(error?.message || "Unknown Bedrock error"),
      requestId:
        error?.$metadata?.requestId || error?.requestId || error?.RequestId || null,
      statusCode:
        error?.$metadata?.httpStatusCode || error?.statusCode || null,
    };

    return details;
  }

  isBedrockPermissionIssue(errorDetails) {
    const name = String(errorDetails?.name || "").toLowerCase();
    const message = String(errorDetails?.message || "").toLowerCase();

    if (name.includes("accessdenied")) {
      return true;
    }

    if (name.includes("validation") && message.includes("operation not allowed")) {
      return true;
    }

    if (message.includes("not authorized") || message.includes("access denied")) {
      return true;
    }

    return false;
  }

  getModelFamily(modelId) {
    const id = String(modelId || "").toLowerCase();
    if (id.startsWith("anthropic.")) {
      return "anthropic";
    }

    if (id.startsWith("meta.")) {
      return "meta";
    }

    return "anthropic";
  }

  buildBedrockPayload(prompt, config) {
    const family = this.getModelFamily(config.modelId);

    if (family === "meta") {
      return {
        family,
        body: {
          prompt,
          temperature: 0.2,
          top_p: 0.9,
          max_gen_len: config.maxTokens,
        },
      };
    }

    return {
      family: "anthropic",
      body: {
        anthropic_version: config.anthropicVersion,
        max_tokens: config.maxTokens,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
      },
    };
  }

  parseBedrockResponse(responseBody, family) {
    if (family === "meta") {
      return {
        text: String(responseBody?.generation || "").trim(),
        inputTokens: Number(
          responseBody?.prompt_token_count || responseBody?.prompt_tokens || 0,
        ),
        outputTokens: Number(
          responseBody?.generation_token_count || responseBody?.completion_tokens || 0,
        ),
      };
    }

    const text = (responseBody?.content || [])
      .map((item) => item?.text || "")
      .join("\n")
      .trim();

    return {
      text,
      inputTokens: Number(responseBody?.usage?.input_tokens || 0),
      outputTokens: Number(responseBody?.usage?.output_tokens || 0),
    };
  }

  buildPrompt(lines) {
    return [
      "SYSTEM: Bạn là AI tóm tắt hội thoại.",
      "",
      "⚠️ STRICT FORMAT REQUIREMENT:",
      "- BẮT BUỘC chỉ trả về JSON hợp lệ.",
      "- KHÔNG được thêm bất kỳ text nào ngoài JSON.",
      "- KHÔNG markdown, KHÔNG giải thích, KHÔNG ghi chú.",
      "- Nếu không tuân thủ -> response bị reject.",
      "",
      "OUTPUT FORMAT (EXACT):",
      '{"overview":"..."}',
      "",
      "REQUIREMENTS:",
      "- overview: Tiếng Việt, ngắn gọn <= 300 ký tự",
      "- Chỉ tóm tắt ý chính từ dữ liệu được cung cấp",
      "- Không bịa thêm thông tin",
      "",
      "MESSAGES:",
      ...lines,
    ].join("\n");
  }

  async invokeGemini(prompt, config, requestId = "unknown", retryCount = 0) {
    try {
      const retryLabel = retryCount > 0 ? ` [RETRY ${retryCount}]` : "";
      console.log(`[AiSummary][${requestId}] Calling Gemini${retryLabel}...`);
      
      const startTime = Date.now();
      
      const contents = [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ];

      const responseText = await this.aiService.generateTextWithGemini(
        contents,
        null,
        {
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: Math.min(config.maxTokens || 300, 500),
            topP: 0.8,
          },
          timeoutMs: config.timeoutMs || 8000,
        },
      );

      const latency = Date.now() - startTime;
      console.log(`[AiSummary][${requestId}] ✅ Gemini response received (${latency}ms), length: ${responseText?.length || 0}`);

      if (!responseText || responseText.trim().length === 0) {
        console.error(`[AiSummary][${requestId}] ❌ Gemini returned EMPTY response`);
        throw new Error("Gemini empty response");
      }

      // Log full response if debug enabled
      if (process.env.AI_SUMMARY_DEBUG === "true") {
        console.log(`[AiSummary][${requestId}]\n===== FULL GEMINI RESPONSE =====\n${responseText}\n=================================\n`);
      } else {
        console.log(`[AiSummary][${requestId}] Response preview (first 200 chars): ${responseText.slice(0, 200)}`);
      }

      return {
        text: responseText,
        inputTokens: 0,
        outputTokens: 0,
      };
    } catch (error) {
      console.error(`[AiSummary][${requestId}] ❌ Gemini invoke error: ${error.message || error}`);
      throw error;
    }
  }

  async reserveDailyUsageBudget(userId, dayKey, reservation, config) {
    const reservationCost = Number(reservation.estimatedCostUsd || 0);
    const maxCostBeforeReservation = Number(
      (config.maxUsdPerUserPerDay - reservationCost).toFixed(6),
    );

    if (maxCostBeforeReservation < 0) {
      return null;
    }

    await AiUsageDaily.updateOne(
      { userId, dayKey, feature: "unread_summary" },
      {
        $setOnInsert: {
          userId,
          dayKey,
          feature: "unread_summary",
          requestCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
      },
      { upsert: true },
    );

    const updated = await AiUsageDaily.findOneAndUpdate(
      {
        userId,
        dayKey,
        feature: "unread_summary",
        requestCount: { $lt: config.maxSummaryRequestsPerDay },
        estimatedCostUsd: { $lte: maxCostBeforeReservation },
      },
      {
        $inc: {
          requestCount: 1,
          inputTokens: reservation.inputTokens || 0,
          outputTokens: reservation.outputTokens || 0,
          estimatedCostUsd: reservationCost,
        },
      },
      {
        new: true,
      },
    );

    return updated;
  }

  async rollbackDailyUsageBudget(userId, dayKey, reservation) {
    await AiUsageDaily.updateOne(
      { userId, dayKey, feature: "unread_summary" },
      {
        $inc: {
          requestCount: -1,
          inputTokens: -(reservation.inputTokens || 0),
          outputTokens: -(reservation.outputTokens || 0),
          estimatedCostUsd: -(reservation.estimatedCostUsd || 0),
        },
      },
    );
  }

  async invokeBedrock(prompt, config) {
    const client = this.getClient(config.region);
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), config.timeoutMs);
    const payload = this.buildBedrockPayload(prompt, config);

    const command = new InvokeModelCommand({
      modelId: config.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload.body),
    });

    try {
      const response = await client.send(command, {
        abortSignal: abortController.signal,
      });

      const responseBody = JSON.parse(Buffer.from(response.body).toString("utf8"));
      const parsed = this.parseBedrockResponse(responseBody, payload.family);

      if (!parsed.text) {
        throw new Error(
          `Bedrock response empty text for family=${payload.family} model=${config.modelId}`,
        );
      }

      return parsed;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async getDailyUsage(userId, dayKey) {
    const usage = await AiUsageDaily.findOne({
      userId,
      dayKey,
      feature: "unread_summary",
    }).lean();

    return (
      usage || {
        userId,
        dayKey,
        feature: "unread_summary",
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      }
    );
  }

  buildAdaptiveSummaryMode(dailyUsage, config, effectiveMaxMessages) {
    const spent = Number(dailyUsage?.estimatedCostUsd || 0);

    if (spent >= config.maxUsdPerUserPerDay * 0.8) {
      return {
        effectiveMaxMessages: Math.min(effectiveMaxMessages, 50),
        maxTokens: Math.min(config.maxTokens, 120),
        maxInputCharsPerMessage: Math.min(config.maxInputCharsPerMessage, 180),
      };
    }

    return {
      effectiveMaxMessages,
      maxTokens: config.maxTokens,
      maxInputCharsPerMessage: config.maxInputCharsPerMessage,
    };
  }

  async upsertDailyUsage(userId, dayKey, usageDelta) {
    await AiUsageDaily.updateOne(
      { userId, dayKey, feature: "unread_summary" },
      {
        $setOnInsert: {
          userId,
          dayKey,
          feature: "unread_summary",
        },
        $inc: {
          requestCount: usageDelta.requestCount || 0,
          inputTokens: usageDelta.inputTokens || 0,
          outputTokens: usageDelta.outputTokens || 0,
          estimatedCostUsd: usageDelta.estimatedCostUsd || 0,
        },
      },
      { upsert: true },
    );
  }

  async getUnreadSummary(userId, conversationId, { maxMessages, forceRefresh, messageIds } = {}) {
    const config = this.getConfig();
    await this.ensureGroupConversationMember(conversationId, userId);
    const shouldForceRefresh = this.parseBoolean(forceRefresh, false);
    const selectedMessageIds = this.normalizeMessageIds(messageIds);
    const hasExplicitSelection = selectedMessageIds.length > 0;

    const effectiveMaxMessages = Math.min(
      Math.max(Number.parseInt(maxMessages || config.maxMessages, 10), 20),
      config.maxMessages,
    );

    const pendingStateQuery = {
      userId,
      conversationId,
      status: "pending",
    };

    if (hasExplicitSelection) {
      pendingStateQuery.messageId = { $in: selectedMessageIds };
    }

    const pendingStates = await AiSummaryMessageState.find(pendingStateQuery)
      .sort({ receivedAt: 1, _id: 1 })
      .limit(effectiveMaxMessages)
      .select("_id messageId receivedAt")
      .lean();

    const pendingMessageIds = pendingStates.map((state) => state.messageId);
    const unreadCount = pendingMessageIds.length;

    if (unreadCount < config.minUnreadThreshold && !hasExplicitSelection) {
      return {
        status: "below_threshold",
        assistantName: config.assistantName,
        unreadCount,
        threshold: config.minUnreadThreshold,
        summary: null,
        cached: false,
      };
    }

    const unreadMessagesRaw = await Message.find({
      _id: { $in: pendingMessageIds },
      deletedFor: { $ne: userId },
      isUnsent: { $ne: true },
      type: { $ne: "system" },
    })
      .sort({ createdAt: 1, _id: 1 })
      .select("_id content type isUnsent createdAt senderId")
      .populate("senderId", "displayName")
      .lean();

    const unreadMessageById = new Map(
      unreadMessagesRaw.map((message) => [String(message._id), message]),
    );

    const unreadMessages = pendingStates
      .map((state) => unreadMessageById.get(String(state.messageId)))
      .filter(Boolean);

    if (unreadMessages.length === 0) {
      return {
        status: "no_unread_messages",
        assistantName: config.assistantName,
        unreadCount,
        summary: null,
        cached: false,
      };
    }

    const newestUnreadMessageId = unreadMessages[unreadMessages.length - 1]?._id;
    const fingerprint = this.buildFingerprint({
      userId,
      conversationId,
      newestUnreadMessageId,
      unreadCount,
    });
    const cacheKey = this.buildCacheKey({ userId, conversationId, fingerprint });

    if (!shouldForceRefresh) {
      const cachedSummary = await this.getCachedSummary(cacheKey);
      if (cachedSummary) {
        return {
          status: "ok",
          assistantName: cachedSummary.assistantName || config.assistantName,
          unreadCount,
          summaryId: cachedSummary.summaryId || null,
          summary: cachedSummary.summary,
          summarizedFromAt: cachedSummary.summarizedFromAt || null,
          summarizedToAt: cachedSummary.summarizedToAt || null,
          cached: true,
        };
      }
    }

    const now = new Date();

    const lines = this.buildModelInput(unreadMessages, config.maxInputCharsPerMessage);
    if (lines.length === 0) {
      return {
        status: "no_eligible_messages",
        assistantName: config.assistantName,
        unreadCount,
        summary: null,
        cached: false,
      };
    }

    const estimatedInputTokens = this.estimateTokensFromLines(lines);
    const estimatedOutputTokens = config.maxTokens;
    const estimatedNewCost = this.estimateCostUsd(
      estimatedInputTokens,
      estimatedOutputTokens,
      config,
    );

    const dayKey = this.getDayKey(now);
    const dailyUsage = await this.getDailyUsage(userId, dayKey);
    const adaptiveMode = this.buildAdaptiveSummaryMode(
      dailyUsage,
      config,
      effectiveMaxMessages,
    );

    const finalLines = this.buildModelInput(
      unreadMessages.slice(0, adaptiveMode.effectiveMaxMessages),
      adaptiveMode.maxInputCharsPerMessage,
    );
    const finalEstimatedInputTokens = this.estimateTokensFromLines(finalLines);
    const finalEstimatedOutputTokens = adaptiveMode.maxTokens;
    const finalEstimatedCost = this.estimateCostUsd(
      finalEstimatedInputTokens,
      finalEstimatedOutputTokens,
      config,
    );

    if (dailyUsage.requestCount >= config.maxSummaryRequestsPerDay) {
      throw {
        statusCode: 429,
        message: "Bạn đã đạt giới hạn số lần tóm tắt AI trong ngày",
      };
    }

    if (Number(dailyUsage.estimatedCostUsd || 0) + finalEstimatedCost > config.maxUsdPerUserPerDay) {
      throw {
        statusCode: 429,
        message: "Bạn đã đạt giới hạn chi phí AI trong ngày (1 USD/user)",
      };
    }

    const reservedBudget = await this.reserveDailyUsageBudget(
      userId,
      dayKey,
      {
        inputTokens: finalEstimatedInputTokens,
        outputTokens: finalEstimatedOutputTokens,
        estimatedCostUsd: finalEstimatedCost,
      },
      config,
    );

    if (!reservedBudget) {
      throw {
        statusCode: 429,
        message: "Bạn đã đạt giới hạn chi phí AI trong ngày (1 USD/user)",
      };
    }

    const requestId = `${userId.toString().slice(-8)}-${Date.now() % 10000}`;
    let summaryResult;
    let modelUsed;

    try {
      console.log(`\n[AiSummary][${requestId}] ========== START UNREAD SUMMARY REQUEST ==========`);
      console.log(`[AiSummary][${requestId}] ConversationId: ${conversationId}, Unread: ${unreadMessages.length}`);
      
      console.log(`[AiSummary][${requestId}] Building prompt with ${finalLines.length} message lines`);
      console.log(`[AiSummary][${requestId}] Sample finalLines:`, finalLines.slice(0, 2));
      
      const prompt = this.buildPrompt(finalLines);
      
      console.log(`[AiSummary][${requestId}] Prompt length: ${prompt.length}`);
      
      // Log FULL prompt if debug enabled
      if (process.env.AI_SUMMARY_DEBUG === "true") {
        console.log(`[AiSummary][${requestId}]\n===== FULL PROMPT SENT TO AI =====\n${prompt}\n====================================\n`);
      }
      
      // Use Gemini API for summary generation (Bedrock not configured)
      if (!config.modelId) {
        console.log(`[AiSummary][${requestId}] 📤 MODEL USED: gemini-2.5-flash (Bedrock not configured)`);
        
        try {
          summaryResult = await this.invokeGemini(prompt, {
            maxTokens: adaptiveMode.maxTokens,
            timeoutMs: config.timeoutMs,
          }, requestId, 0);
          modelUsed = "gemini-2.5-flash";
        } catch (primaryError) {
          console.warn(`[AiSummary][${requestId}] ⚠️ Primary attempt failed, retrying with reinforced prompt...`);
          
          // RETRY 1: Reinforce prompt with explicit instruction
          const reinforcedPrompt = prompt + "\n\n🔴 CRITICAL: You MUST return ONLY valid JSON, nothing else!";
          summaryResult = await this.invokeGemini(reinforcedPrompt, {
            maxTokens: adaptiveMode.maxTokens,
            timeoutMs: config.timeoutMs,
          }, requestId, 1);
          modelUsed = "gemini-2.5-flash";
        }
      } else {
        summaryResult = await this.invokeBedrock(prompt, {
          ...config,
          maxTokens: adaptiveMode.maxTokens,
          maxInputCharsPerMessage: adaptiveMode.maxInputCharsPerMessage,
        });
        modelUsed = config.modelId;
      }

      const bedrockResult = summaryResult;
      let parsedSummary;
      
      console.log(`[AiSummary][${requestId}] Parsing AI response...`);
      console.log(`[AiSummary][${requestId}] Response type: ${typeof bedrockResult}`);
      console.log(`[AiSummary][${requestId}] Response.text length: ${bedrockResult.text?.length}`);
      
      parsedSummary = this.safeParseSummary(bedrockResult.text, requestId);
      
      console.log(`[AiSummary][${requestId}] ✅ FINAL parsedSummary:`, JSON.stringify(parsedSummary).slice(0, 150));

      const record = await AiSummaryRecord.create({
        userId,
        conversationId,
        fingerprint,
        dayKey,
        unreadCount,
        summarizedFromAt: unreadMessages[0]?.createdAt || null,
        summarizedToAt: unreadMessages[unreadMessages.length - 1]?.createdAt || null,
        summarizedMessageIds: unreadMessages.map((msg) => msg._id),
        summary: parsedSummary,
        assistantName: config.assistantName,
        modelId: modelUsed,
        usage: {
          inputTokens: bedrockResult.inputTokens || finalEstimatedInputTokens,
          outputTokens: bedrockResult.outputTokens || finalEstimatedOutputTokens,
          estimatedCostUsd: finalEstimatedCost,
        },
      });

      const summaryPayload = {
        status: "ok",
        assistantName: config.assistantName,
        unreadCount,
        summaryId: record._id,
        summary: record.summary,
        summarizedFromAt: record.summarizedFromAt,
        summarizedToAt: record.summarizedToAt,
        cached: false,
      };

      await this.setCachedSummary(cacheKey, summaryPayload, config.cacheTtlMinutes);

      await AiSummaryMessageState.updateMany(
        {
          userId,
          conversationId,
          messageId: { $in: unreadMessages.map((msg) => msg._id) },
          status: "pending",
        },
        {
          $set: {
            status: "summarized",
            summarizedAt: now,
            summaryRecordId: record._id,
          },
        },
      );

      console.log(`[AiSummary][${requestId}] ✅ SUCCESS - Summary saved with id: ${record._id}`);
      console.log(`[AiSummary][${requestId}] ========== END SUMMARY (MODEL: ${modelUsed}) ==========\n`);
      return summaryPayload;
    } catch (error) {
      console.error(`[AiSummary][${requestId}] ❌ SUMMARY GENERATION FAILED: ${error?.message}`);
      console.error(`[AiSummary][${requestId}] Stack:`, error?.stack);
      
      // Rollback usage budget
      await this.rollbackDailyUsageBudget(userId, dayKey, {
        inputTokens: finalEstimatedInputTokens,
        outputTokens: finalEstimatedOutputTokens,
        estimatedCostUsd: finalEstimatedCost,
      });

      // Fallback: Generate basic summary without AI
      console.log(`[AiSummary][${requestId}] 🔄 Generating fallback summary...`);
      const fallbackSummary = this.buildFallbackSummary(unreadMessages, config);
      
      const fallbackRecord = await AiSummaryRecord.create({
        userId,
        conversationId,
        fingerprint,
        dayKey,
        unreadCount,
        summarizedFromAt: unreadMessages[0]?.createdAt || null,
        summarizedToAt: unreadMessages[unreadMessages.length - 1]?.createdAt || null,
        summarizedMessageIds: unreadMessages.map((msg) => msg._id),
        summary: fallbackSummary,
        assistantName: config.assistantName,
        modelId: "fallback-basic",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
      });

      const fallbackPayload = {
        status: "degraded",
        degraded: true,
        degradedReason: error?.message || "AI summary generation failed",
        assistantName: config.assistantName,
        unreadCount,
        summaryId: fallbackRecord._id,
        summary: fallbackRecord.summary,
        summarizedFromAt: fallbackRecord.summarizedFromAt,
        summarizedToAt: fallbackRecord.summarizedToAt,
        cached: false,
      };

      await this.setCachedSummary(cacheKey, fallbackPayload, 5);
      console.log(`[AiSummary][${requestId}] ✅ Fallback summary created`);

      return fallbackPayload;
    }
  }

  async getSummaryHistory(userId, conversationId, date) {
    await this.ensureGroupConversationMember(conversationId, userId);

    const dayKey = String(date || this.getDayKey()).trim();
    const records = await AiSummaryRecord.find({
      userId,
      conversationId,
      dayKey,
    })
      .sort({ createdAt: -1 })
      .select(
        "_id dayKey unreadCount assistantName summary.overview summary.urgency createdAt summarizedFromAt summarizedToAt usage",
      )
      .lean();

    return {
      dayKey,
      items: records,
    };
  }

  async getSummaryMessagesByRecordId(userId, conversationId, summaryId) {
    if (!mongoose.Types.ObjectId.isValid(summaryId)) {
      throw { statusCode: 400, message: "summaryId không hợp lệ" };
    }

    await this.ensureGroupConversationMember(conversationId, userId);

    const record = await AiSummaryRecord.findOne({
      _id: summaryId,
      userId,
      conversationId,
    }).lean();

    if (!record) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy bản tóm tắt",
      };
    }

    const messages = await Message.find({
      _id: { $in: record.summarizedMessageIds || [] },
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: 1, _id: 1 })
      .select("_id content type createdAt senderId")
      .populate("senderId", "displayName avatar")
      .lean();

    return {
      summaryId: record._id,
      dayKey: record.dayKey,
      assistantName: record.assistantName,
      summary: record.summary,
      messages,
      summarizedFromAt: record.summarizedFromAt,
      summarizedToAt: record.summarizedToAt,
      unreadCount: record.unreadCount,
      usage: record.usage,
      createdAt: record.createdAt,
    };
  }

  buildFallbackSummary(messages, config = {}) {
    if (!messages || messages.length === 0) {
      return {
        overview: "Không có tin nhắn chưa đọc",
      };
    }

    const senders = new Set();
    let lastMessage = null;

    messages.forEach((msg) => {
      if (msg.senderId?.displayName) {
        senders.add(msg.senderId.displayName);
      }
      if (!lastMessage || msg.createdAt > lastMessage.createdAt) {
        lastMessage = msg;
      }
    });

    const senderList = Array.from(senders).join(", ");
    const timeInfo = lastMessage?.createdAt
      ? new Date(lastMessage.createdAt).toLocaleString("vi-VN")
      : "lúc nữa";

    const overview =
      `Có ${messages.length} tin nhắn từ ${senderList || "những người"}. ` +
      `Tin nhắn gần nhất vào ${timeInfo}.`;

    return {
      overview,
    };
  }
}

module.exports = new AiSummaryService();
