const https = require("https");
const mongoose = require("mongoose");
const Account = require("../models/account.model");
const User = require("../models/user.model");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Setting = require("../models/setting.model");
const { uploadToS3, getSignedUrlFromS3 } = require("../middleware/storage");
const { CONVERSATION_TYPES } = require("../../constants");

class AiService {
  constructor() {
    this.aiBotCache = null;
    this.hasWarnedMissingGeminiKey = false;
  }

  parseBoolean(value, fallbackValue = false) {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value || "")
      .trim()
      .toLowerCase();

    if (!normalized) {
      return fallbackValue;
    }

    if (["1", "true", "on", "yes"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "off", "no"].includes(normalized)) {
      return false;
    }

    return fallbackValue;
  }

  getDefaultAiConfigFromEnv() {
    return {
      isEnabled: this.parseBoolean(process.env.AI_ENABLED, true),
      autoCommentEnabled: this.parseBoolean(
        process.env.AI_AUTO_COMMENT_ENABLED,
        true,
      ),
      botName: String(process.env.AI_BOT_NAME || "").trim(),
      botAvatar: String(process.env.AI_BOT_AVATAR || "").trim(),
      botBio: String(process.env.AI_BOT_BIO || "").trim(),
      conversationName: String(process.env.AI_CONVERSATION_NAME || "").trim(),
    };
  }

  async getOrCreateSettingDoc(key, defaults = {}) {
    const existing = await Setting.findOne({ key });
    if (existing) {
      return existing;
    }

    try {
      return await Setting.create({
        key,
        value: defaults,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return await Setting.findOne({ key });
      }
      throw error;
    }
  }

  async migrateLegacyAiSettingIfAny() {
    const legacyCollectionNames = ["aisettings", "ai-settings"];

    for (const collectionName of legacyCollectionNames) {
      try {
        const legacyDoc = await mongoose.connection
          .collection(collectionName)
          .findOne({ key: "default" });

        if (!legacyDoc) {
          continue;
        }

        const migrated = {
          isEnabled: this.parseBoolean(legacyDoc.isEnabled, true),
          autoCommentEnabled: this.parseBoolean(
            legacyDoc.autoCommentEnabled,
            true,
          ),
          botName: String(legacyDoc.botName || "").trim(),
          botAvatar: String(legacyDoc.botAvatar || "").trim(),
          botBio: String(legacyDoc.botBio || "").trim(),
          conversationName: String(
            legacyDoc.conversationName ||
              process.env.AI_CONVERSATION_NAME ||
              "",
          ).trim(),
        };

        const existing = await Setting.findOne({ key: "ai" });
        if (existing) {
          existing.value = {
            ...(existing.value || {}),
            ...migrated,
          };
          existing.markModified("value");
          await existing.save();
          return existing;
        }

        return await Setting.create({ key: "ai", value: migrated });
      } catch (error) {
        // Ignore unknown collection or legacy read errors and keep fallback path.
      }
    }

    return null;
  }

  async getOrCreateAiSettings() {
    const defaults = this.getDefaultAiConfigFromEnv();
    const existing = await Setting.findOne({ key: "ai" });
    if (existing) {
      return existing;
    }

    const migrated = await this.migrateLegacyAiSettingIfAny();
    if (migrated) {
      return migrated;
    }

    return await this.getOrCreateSettingDoc("ai", defaults);
  }

  normalizeAiConfigResponse(settingsDoc) {
    const defaults = this.getDefaultAiConfigFromEnv();
    const settings = settingsDoc?.value || {};

    const botName = String(
      settings?.botName || defaults.botName || "ChatMeNow AI",
    )
      .trim()
      .slice(0, 80);
    const botAvatar = String(settings?.botAvatar || defaults.botAvatar || "")
      .trim()
      .slice(0, 1200);
    const botBio = String(
      settings?.botBio ||
        defaults.botBio ||
        "Trợ lý AI hỗ trợ trò chuyện và thảo luận bài viết.",
    )
      .trim()
      .slice(0, 280);
    const conversationName = String(
      settings?.conversationName || defaults.conversationName || "Trợ lý AI",
    )
      .trim()
      .slice(0, 80);

    return {
      isEnabled: this.parseBoolean(settings?.isEnabled, defaults.isEnabled),
      autoCommentEnabled: this.parseBoolean(
        settings?.autoCommentEnabled,
        defaults.autoCommentEnabled,
      ),
      botName,
      botAvatar,
      botBio,
      conversationName,
      updatedAt: settingsDoc?.updatedAt || null,
      geminiModels: this.getGeminiModelCandidates(),
    };
  }

  async getAiAdminConfig() {
    const settings = await this.getOrCreateAiSettings();
    return this.normalizeAiConfigResponse(settings);
  }

  async updateAiAdminConfig(payload, file) {
    const settingDoc = await this.getOrCreateAiSettings();
    const body = payload || {};
    const nextSettings = {
      ...(settingDoc.value || {}),
    };
    let uploadedAvatarKey = "";

    if (Object.prototype.hasOwnProperty.call(body, "isEnabled")) {
      nextSettings.isEnabled = this.parseBoolean(body.isEnabled, true);
    }

    if (Object.prototype.hasOwnProperty.call(body, "autoCommentEnabled")) {
      nextSettings.autoCommentEnabled = this.parseBoolean(
        body.autoCommentEnabled,
        true,
      );
    }

    if (Object.prototype.hasOwnProperty.call(body, "botName")) {
      nextSettings.botName = String(body.botName || "")
        .trim()
        .slice(0, 80);
    }

    if (Object.prototype.hasOwnProperty.call(body, "botAvatar")) {
      nextSettings.botAvatar = String(body.botAvatar || "")
        .trim()
        .slice(0, 1200);
    }

    if (Object.prototype.hasOwnProperty.call(body, "botBio")) {
      nextSettings.botBio = String(body.botBio || "")
        .trim()
        .slice(0, 280);
    }

    if (Object.prototype.hasOwnProperty.call(body, "conversationName")) {
      nextSettings.conversationName = String(body.conversationName || "")
        .trim()
        .slice(0, 80);
    }

    if (file) {
      uploadedAvatarKey = await uploadToS3(file, "avatars/ai");
      nextSettings.botAvatar = uploadedAvatarKey;
    }

    settingDoc.value = nextSettings;
    settingDoc.markModified("value");
    await settingDoc.save();
    this.aiBotCache = null;

    // Do not block config updates if bot profile sync hits legacy data issues.
    try {
      const aiBot = await this.ensureAiBotUser();
      const normalizedConfig = this.normalizeAiConfigResponse(settingDoc);
      const aiUserIds = await this.syncAiProfiles(normalizedConfig, aiBot?._id);
      await this.syncAiConversationMetadata(normalizedConfig, aiUserIds);
    } catch (error) {
      console.warn(
        `[AI] Config saved but failed to sync AI bot profile: ${error?.message || "unknown error"}`,
      );
    }

    return {
      key: uploadedAvatarKey,
      config: this.normalizeAiConfigResponse(settingDoc),
    };
  }

  async getAiAvatarViewUrl() {
    const config = this.normalizeAiConfigResponse(
      await this.getOrCreateAiSettings(),
    );
    const key = String(config.botAvatar || "").trim();

    if (!key) {
      return {
        key: "",
        viewUrl: "",
        expiresIn: 3600,
      };
    }

    if (key.startsWith("http://") || key.startsWith("https://")) {
      return {
        key,
        viewUrl: key,
        expiresIn: 3600,
      };
    }

    const viewUrl = await getSignedUrlFromS3(key);
    return {
      key,
      viewUrl,
      expiresIn: 3600,
    };
  }

  async syncAiProfiles(aiConfig, primaryAiUserId) {
    if (!primaryAiUserId) {
      return [];
    }

    const primaryId = String(primaryAiUserId);
    const [
      explicitAiUsers,
      aiMessageSenderIds,
      aiCommentUserIds,
      aiConversationLastSenderIds,
    ] = await Promise.all([
      User.find({ isAiBot: true }).select("_id").lean(),
      Message.distinct("senderId", { senderSource: "ai" }),
      Comment.distinct("userId", { authorSource: "ai" }),
      Conversation.distinct("lastMessage.senderId", { isAiAssistant: true }),
    ]);

    const mergedIds = new Set([primaryId]);

    for (const row of explicitAiUsers || []) {
      if (row?._id) {
        mergedIds.add(String(row._id));
      }
    }

    for (const id of aiMessageSenderIds || []) {
      if (id) {
        mergedIds.add(String(id));
      }
    }

    for (const id of aiCommentUserIds || []) {
      if (id) {
        mergedIds.add(String(id));
      }
    }

    for (const id of aiConversationLastSenderIds || []) {
      if (id) {
        mergedIds.add(String(id));
      }
    }

    await User.updateMany(
      { _id: { $in: [...mergedIds] } },
      {
        $set: {
          displayName: aiConfig.botName,
          avatar: aiConfig.botAvatar,
          bio: aiConfig.botBio,
          isAiBot: true,
        },
      },
    );

    return [...mergedIds];
  }

  async syncAiConversationMetadata(aiConfig, aiUserIds = []) {
    const legacySelectors = [
      {
        type: CONVERSATION_TYPES.PRIVATE,
        isAiAssistant: true,
      },
    ];

    if (aiUserIds.length > 0) {
      legacySelectors.push({
        type: CONVERSATION_TYPES.PRIVATE,
        members: { $elemMatch: { userId: { $in: aiUserIds } } },
      });
    }

    await Conversation.updateMany(
      { $or: legacySelectors },
      {
        $set: {
          name: aiConfig.conversationName,
          isPinned: true,
          isAiAssistant: true,
        },
      },
    );

    if (aiUserIds.length > 0) {
      await Conversation.updateMany(
        {
          type: CONVERSATION_TYPES.PRIVATE,
          isAiAssistant: true,
          "lastMessage.senderId": { $in: aiUserIds },
        },
        {
          $set: {
            "lastMessage.senderName": aiConfig.botName,
          },
        },
      );
    }
  }

  async getAiUsageStats(days = 7) {
    const parsedDays = Number.parseInt(days, 10);
    const safeDays = Number.isFinite(parsedDays)
      ? Math.min(Math.max(parsedDays, 1), 365)
      : 7;

    const aiBot = await this.ensureAiBotUser();
    const aiBotId = aiBot._id;
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const aiConversations = await Conversation.find({
      type: CONVERSATION_TYPES.PRIVATE,
      isAiAssistant: true,
    })
      .select("_id")
      .lean();

    const aiConversationIds = aiConversations.map((item) => item._id);

    if (aiConversationIds.length === 0) {
      return {
        periodDays: safeDays,
        since,
        aiConversations: 0,
        chat: {
          totalUserMessages: 0,
          totalAiReplies: 0,
          totalMessages: 0,
          activeUsers: 0,
          inPeriodUserMessages: 0,
          inPeriodAiReplies: 0,
          inPeriodMessages: 0,
          inPeriodActiveUsers: 0,
        },
        comments: {
          totalAiComments: 0,
          totalDiscussionStarters: 0,
          totalAutoReplies: 0,
          inPeriodAiComments: 0,
          inPeriodDiscussionStarters: 0,
          inPeriodAutoReplies: 0,
        },
      };
    }

    const [
      totalUserMessages,
      totalAiReplies,
      activeUsers,
      inPeriodUserMessages,
      inPeriodAiReplies,
      inPeriodActiveUsers,
      totalAiComments,
      totalDiscussionStarters,
      totalAutoReplies,
      inPeriodAiComments,
      inPeriodDiscussionStarters,
      inPeriodAutoReplies,
    ] = await Promise.all([
      Message.countDocuments({
        conversationId: { $in: aiConversationIds },
        senderId: { $ne: aiBotId },
      }),
      Message.countDocuments({
        conversationId: { $in: aiConversationIds },
        senderId: aiBotId,
      }),
      Message.distinct("senderId", {
        conversationId: { $in: aiConversationIds },
        senderId: { $ne: aiBotId },
      }),
      Message.countDocuments({
        conversationId: { $in: aiConversationIds },
        senderId: { $ne: aiBotId },
        createdAt: { $gte: since },
      }),
      Message.countDocuments({
        conversationId: { $in: aiConversationIds },
        senderId: aiBotId,
        createdAt: { $gte: since },
      }),
      Message.distinct("senderId", {
        conversationId: { $in: aiConversationIds },
        senderId: { $ne: aiBotId },
        createdAt: { $gte: since },
      }),
      Comment.countDocuments({ userId: aiBotId }),
      Comment.countDocuments({ userId: aiBotId, replyToCommentId: null }),
      Comment.countDocuments({
        userId: aiBotId,
        replyToCommentId: { $ne: null },
      }),
      Comment.countDocuments({ userId: aiBotId, createdAt: { $gte: since } }),
      Comment.countDocuments({
        userId: aiBotId,
        replyToCommentId: null,
        createdAt: { $gte: since },
      }),
      Comment.countDocuments({
        userId: aiBotId,
        replyToCommentId: { $ne: null },
        createdAt: { $gte: since },
      }),
    ]);

    return {
      periodDays: safeDays,
      since,
      aiConversations: aiConversationIds.length,
      chat: {
        totalUserMessages,
        totalAiReplies,
        totalMessages: totalUserMessages + totalAiReplies,
        activeUsers: activeUsers.length,
        inPeriodUserMessages,
        inPeriodAiReplies,
        inPeriodMessages: inPeriodUserMessages + inPeriodAiReplies,
        inPeriodActiveUsers: inPeriodActiveUsers.length,
      },
      comments: {
        totalAiComments,
        totalDiscussionStarters,
        totalAutoReplies,
        inPeriodAiComments,
        inPeriodDiscussionStarters,
        inPeriodAutoReplies,
      },
    };
  }

  getGeminiApiKey() {
    return (
      process.env.GEMINI_API_KEY ||
      process.env.GERMINI_API_KEY ||
      process.env.GOOGLE_GEMINI_API_KEY ||
      ""
    );
  }

  getGeminiModel() {
    return process.env.GEMINI_MODEL || "";
  }

  normalizeGeminiModelName(model) {
    return String(model || "")
      .trim()
      .replace(/^models\//, "");
  }

  getGeminiModelCandidates() {
    const configuredModel = this.normalizeGeminiModelName(
      this.getGeminiModel(),
    );

    const envList = String(
      process.env.GEMINI_MODEL_CANDIDATES || process.env.GEMINI_MODELS || "",
    )
      .split(",")
      .map((model) => this.normalizeGeminiModelName(model))
      .filter(Boolean);

    const candidates = [configuredModel, ...envList].filter(Boolean);

    return [...new Set(candidates)];
  }

  async isAutoCommentEnabled() {
    const settings = this.normalizeAiConfigResponse(
      await this.getOrCreateAiSettings(),
    );
    const envEnabled = this.parseBoolean(
      process.env.AI_AUTO_COMMENT_ENABLED,
      true,
    );
    return Boolean(
      settings.isEnabled && settings.autoCommentEnabled && envEnabled,
    );
  }

  async postJson(url, payload, { timeoutMs = 8000 } = {}) {
    const parsedUrl = new URL(url);
    const body = JSON.stringify(payload || {});

    return await new Promise((resolve, reject) => {
      let timedOut = false;
      const req = https.request(
        {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || undefined,
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          if (timedOut) {
            return;
          }

          let responseBody = "";

          res.on("data", (chunk) => {
            responseBody += chunk;
          });

          res.on("end", () => {
            let parsedResponse = null;
            try {
              parsedResponse = responseBody ? JSON.parse(responseBody) : {};
            } catch (error) {
              parsedResponse = { raw: responseBody };
            }

            if (res.statusCode >= 400) {
              return reject({
                statusCode: res.statusCode,
                body: parsedResponse,
              });
            }

            return resolve(parsedResponse);
          });
        },
      );

      req.setTimeout(timeoutMs, () => {
        timedOut = true;
        req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  normalizeGeneratedText(rawText, fallbackText) {
    const cleaned = String(rawText || "")
      .replace(/\r/g, "")
      .trim();

    if (!cleaned) {
      return fallbackText;
    }

    return cleaned.length > 6000 ? `${cleaned.slice(0, 5997)}...` : cleaned;
  }

  async generateTextWithGemini(
    contents,
    fallbackText,
    { generationConfig = {}, timeoutMs = 8000 } = {},
  ) {
    const apiKey = this.getGeminiApiKey();

    if (!apiKey) {
      if (!this.hasWarnedMissingGeminiKey) {
        this.hasWarnedMissingGeminiKey = true;
        console.warn(
          "[AI] Missing Gemini API key. Set GEMINI_API_KEY in environment.",
        );
      }
      return "AI chưa được cấu hình (thiếu GEMINI_API_KEY). Vui lòng báo admin cấu hình để mình trả lời được.";
    }

    const payload = {
      systemInstruction: {
        parts: [
          {
            text: "Bạn là trợ lý AI của ChatMeNow. Luôn trả lời bằng tiếng Việt, dễ hiểu, tôn trọng người dùng, ngắn gọn và hữu ích.",
          },
        ],
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 512,
        ...generationConfig,
      },
    };

    const modelCandidates = this.getGeminiModelCandidates();

    if (modelCandidates.length === 0) {
      console.error(
        "[AI] Missing Gemini model config. Set GEMINI_MODEL or GEMINI_MODEL_CANDIDATES.",
      );
      return fallbackText;
    }

    let lastError = null;

    for (const model of modelCandidates) {
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
        `:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const response = await this.postJson(endpoint, payload, { timeoutMs });
        const parts = response?.candidates?.[0]?.content?.parts || [];
        const text = parts.map((item) => item?.text || "").join("\n");
        return this.normalizeGeneratedText(text, fallbackText);
      } catch (error) {
        lastError = error;

        const code = error?.body?.error?.status || "";
        const notFound =
          Number(error?.statusCode) === 404 ||
          String(code).includes("NOT_FOUND");

        if (notFound) {
          console.warn(
            `[AI] Gemini model '${model}' not found. Trying next fallback model...`,
          );
          continue;
        }

        break;
      }
    }

    const statusCode = lastError?.statusCode || "unknown";
    const details = lastError?.body
      ? JSON.stringify(lastError.body).slice(0, 500)
      : lastError?.message || "No details";

    console.error(
      `[AI] Gemini generateContent failed after trying models [${modelCandidates.join(", ")}]. status=${statusCode} details=${details}`,
    );
    return fallbackText;
  }

  async ensureAiBotUser() {
    if (this.aiBotCache?.userId) {
      const cachedUser = await User.findById(this.aiBotCache.userId).select(
        "displayName avatar bio isAiBot",
      );
      if (cachedUser && cachedUser.isAiBot) {
        return cachedUser;
      }
    }

    const aiConfig = await this.getOrCreateAiSettings();
    const normalizedConfig = this.normalizeAiConfigResponse(aiConfig);
    const botDisplayName = normalizedConfig.botName;
    const botAvatar = normalizedConfig.botAvatar;
    const botBio = normalizedConfig.botBio;

    let user = await User.findOne({ isAiBot: true }).sort({ createdAt: 1 });

    // Legacy migration: old AI bot was linked to Account by email.
    if (!user) {
      const legacyEmail = String(process.env.AI_BOT_EMAIL || "").trim();
      if (legacyEmail) {
        const legacyAccount = await Account.findOne({ email: legacyEmail })
          .select("_id")
          .lean();

        if (legacyAccount?._id) {
          user = await User.findOne({ accountId: legacyAccount._id });
          if (user && user.isAiBot !== true) {
            user.isAiBot = true;
            await user.save();
          }
        }
      }
    }

    if (!user) {
      user = await User.create({
        displayName: botDisplayName,
        avatar: botAvatar,
        bio: botBio,
        isAiBot: true,
      });
    } else if (
      user.displayName !== botDisplayName ||
      user.avatar !== botAvatar ||
      user.bio !== botBio ||
      user.isAiBot !== true
    ) {
      user.displayName = botDisplayName;
      user.avatar = botAvatar;
      user.bio = botBio;
      user.isAiBot = true;
      await user.save();
    }

    this.aiBotCache = {
      userId: user._id.toString(),
    };

    return user;
  }

  isUserInConversation(conversation, userId) {
    const normalizedUserId = String(userId);
    return conversation.members.some(
      (member) => String(member.userId) === normalizedUserId,
    );
  }

  async detectAiConversationForUser(userId, conversationId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return { isAiConversation: false, conversation: null, aiBot: null };
    }

    const conversation = await Conversation.findById(conversationId)
      .select("_id type name isAiAssistant isPinned members.userId")
      .lean();

    if (!conversation) {
      return { isAiConversation: false, conversation: null, aiBot: null };
    }

    if (!this.isUserInConversation(conversation, userId)) {
      throw {
        statusCode: 403,
        message: "Bạn không có quyền truy cập cuộc trò chuyện này",
      };
    }

    const aiBot = await this.ensureAiBotUser();
    const hasAiMember = (conversation.members || []).some(
      (member) => String(member.userId) === String(aiBot._id),
    );

    const isLegacyAiConversation =
      conversation.type === CONVERSATION_TYPES.PRIVATE && hasAiMember;
    const isAiConversation = Boolean(
      conversation.isAiAssistant || isLegacyAiConversation,
    );

    if (isLegacyAiConversation && !conversation.isAiAssistant) {
      const aiConfig = this.normalizeAiConfigResponse(
        await this.getOrCreateAiSettings(),
      );
      await Conversation.findByIdAndUpdate(conversation._id, {
        isAiAssistant: true,
        isPinned: true,
        name: conversation.name || aiConfig.conversationName,
      });
    }

    return {
      isAiConversation,
      conversation,
      aiBot,
    };
  }

  async getOrCreateAiConversation(userId) {
    const aiConfig = this.normalizeAiConfigResponse(
      await this.getOrCreateAiSettings(),
    );
    if (!aiConfig.isEnabled) {
      throw {
        statusCode: 403,
        message: "AI chat đang tạm thời bị tắt",
      };
    }

    const aiBot = await this.ensureAiBotUser();
    const aiUsers = await User.find({ isAiBot: true }).select("_id").lean();
    const aiUserIds = [
      ...new Set([
        String(aiBot._id),
        ...aiUsers.map((item) => String(item._id)),
      ]),
    ].map((id) => new mongoose.Types.ObjectId(id));

    let conversation = await Conversation.findOne({
      $or: [
        {
          type: CONVERSATION_TYPES.PRIVATE,
          isAiAssistant: true,
          members: { $elemMatch: { userId } },
        },
        {
          type: CONVERSATION_TYPES.PRIVATE,
          members: { $elemMatch: { userId } },
          $and: [
            {
              members: {
                $elemMatch: {
                  userId: { $in: aiUserIds },
                },
              },
            },
          ],
        },
      ],
    }).sort({ updatedAt: -1, _id: -1 });

    if (!conversation) {
      conversation = await Conversation.create({
        type: CONVERSATION_TYPES.PRIVATE,
        name: aiConfig.conversationName,
        isPinned: true,
        isAiAssistant: true,
        members: [{ userId }, { userId: aiBot._id }],
      });
    } else {
      const hasAiMember = (conversation.members || []).some(
        (member) => String(member.userId) === String(aiBot._id),
      );

      if (!hasAiMember) {
        conversation.members.push({ userId: aiBot._id });
      }

      if (
        !conversation.isPinned ||
        conversation.name !== aiConfig.conversationName ||
        !conversation.isAiAssistant ||
        !hasAiMember
      ) {
        conversation.isPinned = true;
        conversation.name = aiConfig.conversationName;
        conversation.isAiAssistant = true;
        await conversation.save();
      }
    }

    return await Conversation.findById(conversation._id)
      .populate("members.userId", "displayName avatar isOnline lastSeen")
      .populate("lastMessage.senderId", "displayName avatar");
  }

  async getValidatedAiConversation(userId, conversationId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw {
        statusCode: 400,
        message: "conversationId không hợp lệ",
      };
    }

    const detection = await this.detectAiConversationForUser(
      userId,
      conversationId,
    );

    if (!detection?.conversation || !detection.isAiConversation) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy cuộc trò chuyện AI",
      };
    }

    return detection.conversation;
  }

  async buildGeminiContentsFromConversation(
    conversationId,
    aiBotUserId,
    historyLimit = 20,
  ) {
    const messages = await Message.find({ conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(historyLimit)
      .select("content senderId senderSource")
      .lean();

    const ordered = messages.reverse();
    const aiUserId = String(aiBotUserId);

    const contents = ordered
      .filter((msg) => msg?.content)
      .map((msg) => ({
        role:
          msg?.senderSource === "ai" || String(msg.senderId) === aiUserId
            ? "model"
            : "user",
        parts: [{ text: msg.content }],
      }));

    if (contents.length === 0) {
      return [{ role: "user", parts: [{ text: "Xin chào" }] }];
    }

    return contents;
  }

  async sendMessageToAi(
    userId,
    {
      content,
      conversationId,
      contextNote,
      historyLimit = 20,
      generationConfig,
      timeoutMs = 8000,
    },
  ) {
    const aiConfig = this.normalizeAiConfigResponse(
      await this.getOrCreateAiSettings(),
    );
    if (!aiConfig.isEnabled) {
      throw {
        statusCode: 403,
        message: "AI chat đang tạm thời bị tắt",
      };
    }

    const trimmedContent = String(content || "").trim();
    if (!trimmedContent) {
      throw {
        statusCode: 400,
        message: "Nội dung không được để trống",
      };
    }

    const aiBot = await this.ensureAiBotUser();

    const aiConversation = conversationId
      ? await this.getValidatedAiConversation(userId, conversationId)
      : await this.getOrCreateAiConversation(userId);

    const conversationIdToUse = aiConversation._id;

    const userMessage = await Message.create({
      conversationId: conversationIdToUse,
      senderId: userId,
      senderSource: "user",
      content: trimmedContent,
      type: "text",
    });
    await userMessage.populate("senderId", "displayName avatar");

    await Conversation.findByIdAndUpdate(conversationIdToUse, {
      lastMessage: {
        content: trimmedContent,
        senderId: userId,
        senderName: userMessage.senderId?.displayName || "Người dùng",
        type: "text",
        createdAt: userMessage.createdAt,
      },
      updatedAt: new Date(),
      isPinned: true,
      isAiAssistant: true,
    });

    const geminiContents = await this.buildGeminiContentsFromConversation(
      conversationIdToUse,
      aiBot._id,
      historyLimit,
    );

    const contextText = String(contextNote || "").trim();
    if (contextText) {
      geminiContents.push({
        role: "user",
        parts: [
          {
            text:
              "Ngữ cảnh bổ sung để trả lời đúng chủ đề (không cần nhắc lại nguyên văn cho người dùng):\n" +
              contextText.slice(0, 3000),
          },
        ],
      });
    }

    const aiReplyText = await this.generateTextWithGemini(
      geminiContents,
      "Mình đang gặp trục trặc nhỏ với AI, bạn thử hỏi lại giúp mình nhé.",
      {
        generationConfig,
        timeoutMs,
      },
    );

    const aiMessage = await Message.create({
      conversationId: conversationIdToUse,
      senderId: aiBot._id,
      senderSource: "ai",
      content: aiReplyText,
      type: "text",
    });
    await aiMessage.populate("senderId", "displayName avatar");

    await Conversation.findByIdAndUpdate(conversationIdToUse, {
      lastMessage: {
        content: aiReplyText,
        senderId: aiBot._id,
        senderName: aiBot.displayName,
        type: "text",
        createdAt: aiMessage.createdAt,
      },
      updatedAt: new Date(),
      isPinned: true,
      isAiAssistant: true,
    });

    const fullConversation = await Conversation.findById(conversationIdToUse)
      .populate("members.userId", "displayName avatar isOnline lastSeen")
      .populate("lastMessage.senderId", "displayName avatar");

    const memberIds = (fullConversation?.members || [])
      .map(
        (member) => member.userId?._id?.toString() || member.userId?.toString(),
      )
      .filter(Boolean);

    return {
      conversation: fullConversation,
      userMessage,
      aiMessage,
      memberIds,
    };
  }

  async ensureAiDiscussionStarter(postId) {
    if (!(await this.isAutoCommentEnabled())) {
      return null;
    }

    const aiBot = await this.ensureAiBotUser();

    const existingStarter = await Comment.findOne({
      postId,
      userId: aiBot._id,
      replyToCommentId: null,
    });

    if (existingStarter) {
      return await existingStarter.populate("userId", "displayName avatar");
    }

    const post = await Post.findById(postId).select("content");
    if (!post) {
      return null;
    }

    const prompt = `Bạn hãy tạo 1 bình luận mở đầu để mời thảo luận cho bài viết sau, độ dài tối đa 2 câu, thân thiện, tiếng Việt.\nBài viết: "${post.content || "Bài viết không có nội dung văn bản"}"`;

    const starterContent = await this.generateTextWithGemini(
      [{ role: "user", parts: [{ text: prompt }] }],
      "Mình là AI hỗ trợ thảo luận. Bạn muốn trao đổi góc nhìn nào về bài viết này?",
    );

    const starterComment = await Comment.create({
      postId,
      userId: aiBot._id,
      authorSource: "ai",
      content: starterContent,
    });

    await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

    return await starterComment.populate("userId", "displayName avatar");
  }

  async buildCommentThreadContext(postId, sourceComment, aiBotId) {
    const recentComments = await Comment.find({ postId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(12)
      .populate("userId", "displayName")
      .lean();

    const parentChain = [];
    let cursor = sourceComment?.replyToCommentId;
    let guard = 0;

    while (cursor && guard < 6) {
      const parent = await Comment.findById(cursor)
        .select("content userId replyToCommentId createdAt")
        .populate("userId", "displayName")
        .lean();

      if (!parent) {
        break;
      }

      parentChain.push(parent);
      cursor = parent.replyToCommentId;
      guard += 1;
    }

    const normalizeLine = (comment) => {
      const displayName = comment?.userId?.displayName || "Người dùng";
      const isAi =
        comment?.authorSource === "ai" ||
        String(comment?.userId?._id || comment?.userId || "") ===
          String(aiBotId);

      return `${isAi ? "AI" : displayName}: ${String(comment?.content || "").slice(0, 300)}`;
    };

    const chainLines = parentChain.reverse().map(normalizeLine);
    const recentLines = recentComments.reverse().map(normalizeLine);

    return {
      chainLines,
      recentLines,
    };
  }

  async createAutoReplyForComment(postId, sourceComment) {
    if (!(await this.isAutoCommentEnabled())) {
      return null;
    }

    if (!sourceComment?.userId) {
      return null;
    }

    const aiBot = await this.ensureAiBotUser();
    const sourceUserId = sourceComment.userId?._id || sourceComment.userId;

    if (String(sourceUserId) === String(aiBot._id)) {
      return null;
    }

    const post = await Post.findById(postId).select("content");
    if (!post) {
      return null;
    }

    const context = await this.buildCommentThreadContext(
      postId,
      sourceComment,
      aiBot._id,
    );

    const sourceText = String(sourceComment.content || "").trim();

    const prompt =
      "Bạn là trợ lý thảo luận cho bài post mạng xã hội. " +
      "Hãy trả lời theo đúng mạch hội thoại hiện tại, tự nhiên như đang chat lại với người dùng.\n" +
      "Yêu cầu: trả lời tiếng Việt, 1-3 câu, thân thiện, không giáo điều, có thể đặt 1 câu hỏi gợi mở khi phù hợp.\n" +
      `Nội dung bài viết: "${post.content || "Bài viết không có nội dung văn bản"}"\n` +
      `Chuỗi trả lời liên quan (cũ -> mới):\n${context.chainLines.join("\n") || "(không có)"}\n` +
      `Các bình luận gần đây (cũ -> mới):\n${context.recentLines.join("\n") || "(không có)"}\n` +
      `Tin nhắn người dùng vừa gửi: "${sourceText}"`;

    const aiReplyText = await this.generateTextWithGemini(
      [{ role: "user", parts: [{ text: prompt }] }],
      "Góc nhìn của bạn rất hay. Bạn có thể nói rõ thêm lý do hoặc ví dụ cụ thể để mọi người cùng thảo luận sâu hơn không?",
    );

    const aiReply = await Comment.create({
      postId,
      userId: aiBot._id,
      authorSource: "ai",
      content: aiReplyText,
      replyToCommentId: sourceComment._id,
    });

    await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

    return await aiReply.populate("userId", "displayName avatar");
  }
}

module.exports = new AiService();
