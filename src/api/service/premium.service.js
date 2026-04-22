const Account = require("../models/account.model");
const User = require("../models/user.model");
const Post = require("../models/post.model");
const Reel = require("../models/reel.model");
const Story = require("../models/story.model");
const Setting = require("../models/setting.model");
const Transaction = require("../models/transaction.model");
const mongoose = require("mongoose");
const crypto = require("crypto");
const {
  PREMIUM_SETTING_KEY,
  PREMIUM_TIERS,
  PREMIUM_DEFAULT_CONFIG,
} = require("../../constants/premium.constants");
const { TRANSACTION_STATUS } = require("../../constants");
const {
  VNPay,
  ProductCode,
  IpnFailChecksum,
  IpnOrderNotFound,
  IpnInvalidAmount,
  InpOrderAlreadyConfirmed,
  IpnSuccess,
  IpnUnknownError,
  parseDate,
} = require("vnpay");

class PremiumService {
  constructor() {
    this.vnpayClient = null;
  }

  toPositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  toPositiveInteger(value, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  mergeObjects(base, override) {
    if (Array.isArray(base)) {
      return Array.isArray(override) ? override : base;
    }

    if (!base || typeof base !== "object") {
      return override === undefined ? base : override;
    }

    const output = { ...base };
    const input = override && typeof override === "object" ? override : {};

    Object.keys(input).forEach((key) => {
      output[key] = this.mergeObjects(base[key], input[key]);
    });

    return output;
  }

  normalizePlan(plan, index) {
    const defaultPlan = PREMIUM_DEFAULT_CONFIG.plans[index] || {};
    const code = String(plan?.code || defaultPlan.code || "").trim();

    if (!code) {
      throw {
        statusCode: 400,
        message: `plans[${index}].code không được để trống`,
      };
    }

    return {
      code,
      name: String(plan?.name || defaultPlan.name || code).trim(),
      description: String(
        plan?.description || defaultPlan.description || "",
      ).trim(),
      price: this.toPositiveNumber(plan?.price, defaultPlan.price || 99000),
      durationDays: this.toPositiveInteger(
        plan?.durationDays,
        defaultPlan.durationDays || 30,
      ),
      isRecommended: Boolean(plan?.isRecommended || false),
    };
  }

  normalizeConfig(rawConfig = {}) {
    const merged = this.mergeObjects(PREMIUM_DEFAULT_CONFIG, rawConfig || {});
    const plansInput = Array.isArray(rawConfig?.plans)
      ? rawConfig.plans
      : merged.plans;
    const plans = plansInput.map((plan, index) =>
      this.normalizePlan(plan, index),
    );

    const planCodeSet = new Set();
    plans.forEach((plan) => {
      if (planCodeSet.has(plan.code)) {
        throw {
          statusCode: 400,
          message: `Mã gói '${plan.code}' đang bị trùng`,
        };
      }
      planCodeSet.add(plan.code);
    });

    const defaultPlanCode =
      planCodeSet.has(merged.defaultPlanCode) && merged.defaultPlanCode
        ? merged.defaultPlanCode
        : plans[0]?.code;

    return {
      version: this.toPositiveInteger(merged.version, 1),
      currency: String(merged.currency || "VND").trim() || "VND",
      defaultPlanCode,
      free: {
        name: String(merged.free?.name || "Free").trim() || "Free",
        features: {
          aiAssistant: Boolean(merged.free?.features?.aiAssistant),
          advancedAiSummary: Boolean(merged.free?.features?.advancedAiSummary),
          prioritySupport: Boolean(merged.free?.features?.prioritySupport),
        },
        limits: {
          postsPerDay: this.toPositiveInteger(
            merged.free?.limits?.postsPerDay,
            3,
          ),
          reelsPerDay: this.toPositiveInteger(
            merged.free?.limits?.reelsPerDay,
            1,
          ),
          storiesPerDay: this.toPositiveInteger(
            merged.free?.limits?.storiesPerDay,
            5,
          ),
          postVideoDurationSeconds: this.toPositiveInteger(
            merged.free?.limits?.postVideoDurationSeconds,
            120,
          ),
          reelVideoDurationSeconds: this.toPositiveInteger(
            merged.free?.limits?.reelVideoDurationSeconds,
            45,
          ),
          storyVideoDurationSeconds: this.toPositiveInteger(
            merged.free?.limits?.storyVideoDurationSeconds,
            30,
          ),
        },
      },
      premium: {
        name: String(merged.premium?.name || "Premium").trim() || "Premium",
        features: {
          aiAssistant: Boolean(merged.premium?.features?.aiAssistant),
          advancedAiSummary: Boolean(
            merged.premium?.features?.advancedAiSummary,
          ),
          prioritySupport: Boolean(merged.premium?.features?.prioritySupport),
        },
        limits: {
          postsPerDay: this.toPositiveInteger(
            merged.premium?.limits?.postsPerDay,
            30,
          ),
          reelsPerDay: this.toPositiveInteger(
            merged.premium?.limits?.reelsPerDay,
            20,
          ),
          storiesPerDay: this.toPositiveInteger(
            merged.premium?.limits?.storiesPerDay,
            30,
          ),
          postVideoDurationSeconds: this.toPositiveInteger(
            merged.premium?.limits?.postVideoDurationSeconds,
            900,
          ),
          reelVideoDurationSeconds: this.toPositiveInteger(
            merged.premium?.limits?.reelVideoDurationSeconds,
            300,
          ),
          storyVideoDurationSeconds: this.toPositiveInteger(
            merged.premium?.limits?.storyVideoDurationSeconds,
            120,
          ),
        },
      },
      plans,
      paymentTemplate: {
        merchantName: String(
          merged.paymentTemplate?.merchantName || "ChatMeNow",
        ).trim(),
        bankName: String(merged.paymentTemplate?.bankName || "").trim(),
        bankAccountNumber: String(
          merged.paymentTemplate?.bankAccountNumber || "",
        ).trim(),
        bankAccountName: String(
          merged.paymentTemplate?.bankAccountName || "",
        ).trim(),
        transferNotePrefix: String(
          merged.paymentTemplate?.transferNotePrefix || "PREM",
        ).trim(),
        qrPlaceholderUrl: String(
          merged.paymentTemplate?.qrPlaceholderUrl || "",
        ).trim(),
        supportMessage: String(
          merged.paymentTemplate?.supportMessage ||
            PREMIUM_DEFAULT_CONFIG.paymentTemplate.supportMessage,
        ).trim(),
      },
    };
  }

  buildStartOfToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  async getOrCreatePremiumConfig() {
    const setting = await Setting.findOne({ key: PREMIUM_SETTING_KEY });
    if (!setting) {
      return this.normalizeConfig(PREMIUM_DEFAULT_CONFIG);
    }

    return this.normalizeConfig(setting.value || {});
  }

  async savePremiumConfig(rawConfig) {
    const currentConfig = await this.getOrCreatePremiumConfig();
    const mergedConfig = this.mergeObjects(currentConfig, rawConfig || {});
    const normalizedConfig = this.normalizeConfig(mergedConfig);

    await Setting.findOneAndUpdate(
      { key: PREMIUM_SETTING_KEY },
      {
        $set: {
          value: normalizedConfig,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    return normalizedConfig;
  }

  isPremiumStillActive(account) {
    if (!account?.isPremium) return false;
    if (!account?.premiumExpiryDate) return false;
    return new Date(account.premiumExpiryDate).getTime() > Date.now();
  }

  async resolveAccountPremiumState(account) {
    if (!account) return account;

    if (
      account.isPremium &&
      account.premiumExpiryDate &&
      new Date(account.premiumExpiryDate).getTime() <= Date.now()
    ) {
      account.isPremium = false;
      account.premiumExpiryDate = null;
      await account.save();
    }

    return account;
  }

  async ensureCanStartPremiumCheckout(account) {
    const resolvedAccount = await this.resolveAccountPremiumState(account);
    if (this.isPremiumStillActive(resolvedAccount)) {
      throw {
        statusCode: 409,
        code: "PREMIUM_ALREADY_ACTIVE",
        message:
          "Tài khoản đang có gói Premium còn hiệu lực. Vui lòng hủy gia hạn trước khi đăng ký gói mới.",
      };
    }
  }

  async getAccessContextByAccount(account) {
    const [config, resolvedAccount] = await Promise.all([
      this.getOrCreatePremiumConfig(),
      this.resolveAccountPremiumState(account),
    ]);

    const isPremiumActive = this.isPremiumStillActive(resolvedAccount);
    const tier = isPremiumActive ? PREMIUM_TIERS.PREMIUM : PREMIUM_TIERS.FREE;
    const tierConfig = config[tier] || config.free;

    return {
      config,
      account: resolvedAccount,
      isPremiumActive,
      tier,
      tierName: tierConfig?.name || tier,
      features: tierConfig?.features || {},
      limits: tierConfig?.limits || {},
      premiumExpiryDate: resolvedAccount?.premiumExpiryDate || null,
    };
  }

  async getAccountByUserId(userId) {
    const user = await User.findById(userId).select(
      "accountId displayName avatar",
    );
    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy người dùng",
      };
    }

    const account = await Account.findById(user.accountId);
    if (!account) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy tài khoản người dùng",
      };
    }

    return { user, account };
  }

  async getAccessContextByUserId(userId) {
    const { user, account } = await this.getAccountByUserId(userId);
    const access = await this.getAccessContextByAccount(account);

    return {
      ...access,
      user,
    };
  }

  async countTodayDocuments(model, fieldName, userId, extraFilter = {}) {
    const startOfToday = this.buildStartOfToday();
    return await model.countDocuments({
      [fieldName]: userId,
      createdAt: { $gte: startOfToday },
      ...extraFilter,
    });
  }

  ensureDailyLimit(currentCount, limit, resourceName) {
    if (!Number.isFinite(limit) || limit <= 0) return;
    if (currentCount >= limit) {
      throw {
        statusCode: 403,
        message: `Bạn đã đạt giới hạn đăng ${resourceName} trong ngày (${limit}/${limit}). Nâng cấp Premium để tăng giới hạn.`,
        code: "PREMIUM_LIMIT_EXCEEDED",
      };
    }
  }

  ensureVideoDuration(duration, maxDuration, resourceName) {
    if (!Number.isFinite(maxDuration) || maxDuration <= 0) return;
    const normalizedDuration = Number(duration || 0);
    if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
      return;
    }

    if (normalizedDuration > maxDuration) {
      throw {
        statusCode: 400,
        message: `Video ${resourceName} vượt quá ${maxDuration} giây theo gói hiện tại.`,
        code: "PREMIUM_VIDEO_DURATION_EXCEEDED",
      };
    }
  }

  async enforcePostCreation(userId, { videoDurations = [] } = {}) {
    const access = await this.getAccessContextByUserId(userId);
    const postLimit = Number(access.limits?.postsPerDay || 0);
    const currentCount = await this.countTodayDocuments(
      Post,
      "authorId",
      userId,
      { isDeleted: { $ne: true } },
    );

    this.ensureDailyLimit(currentCount, postLimit, "bài viết");

    const maxPostVideoDuration = Number(
      access.limits?.postVideoDurationSeconds || 0,
    );
    (videoDurations || []).forEach((duration) => {
      this.ensureVideoDuration(duration, maxPostVideoDuration, "bài viết");
    });
  }

  async enforceReelCreation(userId, { videoDuration } = {}) {
    const access = await this.getAccessContextByUserId(userId);
    const reelLimit = Number(access.limits?.reelsPerDay || 0);
    const currentCount = await this.countTodayDocuments(
      Reel,
      "userId",
      userId,
      { isDeleted: { $ne: true } },
    );

    this.ensureDailyLimit(currentCount, reelLimit, "reel");

    const maxReelVideoDuration = Number(
      access.limits?.reelVideoDurationSeconds || 0,
    );
    if (
      Number.isFinite(maxReelVideoDuration) &&
      maxReelVideoDuration > 0 &&
      (!Number.isFinite(Number(videoDuration)) || Number(videoDuration) <= 0)
    ) {
      throw {
        statusCode: 400,
        message: "Vui lòng gửi videoDuration hợp lệ cho reel",
      };
    }
    this.ensureVideoDuration(videoDuration, maxReelVideoDuration, "reel");
  }

  async enforceStoryCreation(userId, { isVideo, videoDuration } = {}) {
    const access = await this.getAccessContextByUserId(userId);
    const storyLimit = Number(access.limits?.storiesPerDay || 0);
    const currentCount = await this.countTodayDocuments(
      Story,
      "authorId",
      userId,
    );

    this.ensureDailyLimit(currentCount, storyLimit, "story");

    if (isVideo) {
      const maxStoryVideoDuration = Number(
        access.limits?.storyVideoDurationSeconds || 0,
      );
      this.ensureVideoDuration(videoDuration, maxStoryVideoDuration, "story");
    }
  }

  async enforceAiAccess(userId) {
    const access = await this.getAccessContextByUserId(userId);
    if (!access.features?.aiAssistant) {
      throw {
        statusCode: 403,
        message:
          "Tính năng AI chỉ dành cho gói Premium. Vui lòng nâng cấp để tiếp tục.",
        code: "PREMIUM_AI_REQUIRED",
      };
    }
  }

  async getPlans() {
    const config = await this.getOrCreatePremiumConfig();
    return {
      currency: config.currency,
      defaultPlanCode: config.defaultPlanCode,
      plans: config.plans || [],
    };
  }

  async getPlanByCode(planCode) {
    const config = await this.getOrCreatePremiumConfig();
    const selectedCode = String(
      planCode || config.defaultPlanCode || "",
    ).trim();
    const plan = (config.plans || []).find(
      (item) => item.code === selectedCode,
    );

    if (!plan) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy gói Premium",
      };
    }

    return {
      plan,
      config,
    };
  }

  async getMockPaymentTemplate(userId, planCode) {
    const [{ user, account }, { plan, config }] = await Promise.all([
      this.getAccountByUserId(userId),
      this.getPlanByCode(planCode),
    ]);

    const transferCode = `${config.paymentTemplate.transferNotePrefix || "PREM"}-${String(account._id).slice(-6).toUpperCase()}-${String(plan.code).toUpperCase()}`;

    return {
      account: {
        userId: user._id,
        displayName: user.displayName,
        avatar: user.avatar,
      },
      plan,
      currency: config.currency,
      paymentTemplate: {
        ...config.paymentTemplate,
        transferCode,
      },
      sampleUi: {
        title: "Thanh toán Premium (Mẫu)",
        steps: [
          "Bước 1: Chọn gói và xác nhận đơn hàng.",
          "Bước 2: Mở app ngân hàng, chuyển khoản theo thông tin mẫu.",
          "Bước 3: Nhấn 'Tôi đã thanh toán' để BE giả lập xác nhận giao dịch.",
        ],
        ctaPrimary: "Tạo đơn thanh toán mẫu",
        ctaConfirm: "Tôi đã thanh toán (mẫu)",
        htmlSnippet:
          "<section><h2>Thanh toán Premium (Mẫu)</h2><p>Quét QR hoặc chuyển khoản theo thông tin mẫu.</p><button>Tạo đơn thanh toán mẫu</button><button>Tôi đã thanh toán (mẫu)</button></section>",
      },
    };
  }

  async activatePlanForAccount(account, plan) {
    const now = new Date();
    const currentExpiry = account?.premiumExpiryDate
      ? new Date(account.premiumExpiryDate)
      : null;
    const baseTime =
      currentExpiry && currentExpiry.getTime() > now.getTime()
        ? currentExpiry
        : now;
    const expiresAt = new Date(
      baseTime.getTime() +
        Number(plan.durationDays || 30) * 24 * 60 * 60 * 1000,
    );

    account.isPremium = true;
    account.premiumExpiryDate = expiresAt;
    await account.save();

    return expiresAt;
  }

  async startMockCheckout(
    userId,
    { planCode, paymentMethod = "bank_transfer_mock" } = {},
  ) {
    const [{ account }, { plan, config }] = await Promise.all([
      this.getAccountByUserId(userId),
      this.getPlanByCode(planCode),
    ]);
    await this.ensureCanStartPremiumCheckout(account);

    const orderInfo = `Premium ${plan.name} (${plan.durationDays} ngày)`;

    const transaction = await Transaction.create({
      accountId: account._id,
      amount: plan.price,
      orderInfo,
      status: TRANSACTION_STATUS.PENDING,
      transactionType: "premium_purchase",
      paymentProvider: "mock",
      paymentMethod,
      planCode: plan.code,
      planName: plan.name,
      planDurationDays: plan.durationDays,
      isMock: true,
      metadata: {
        flow: "mock_checkout",
      },
    });

    const paymentTemplate = await this.getMockPaymentTemplate(
      userId,
      plan.code,
    );

    return {
      transaction,
      plan,
      currency: config.currency,
      paymentTemplate,
    };
  }

  async confirmMockCheckout(
    userId,
    transactionId,
    { forceStatus = TRANSACTION_STATUS.SUCCESS } = {},
  ) {
    const { account } = await this.getAccountByUserId(userId);
    const transaction = await Transaction.findOne({
      _id: transactionId,
      accountId: account._id,
      transactionType: "premium_purchase",
      isMock: true,
    });

    if (!transaction) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy giao dịch Premium",
      };
    }

    if (transaction.status === TRANSACTION_STATUS.SUCCESS) {
      return {
        transaction,
        premiumExpiryDate: account.premiumExpiryDate,
        alreadyConfirmed: true,
      };
    }

    const normalizedStatus =
      forceStatus === TRANSACTION_STATUS.FAILED
        ? TRANSACTION_STATUS.FAILED
        : TRANSACTION_STATUS.SUCCESS;

    transaction.status = normalizedStatus;
    transaction.confirmedAt = new Date();

    if (normalizedStatus === TRANSACTION_STATUS.SUCCESS) {
      const durationDays = this.toPositiveInteger(
        transaction.planDurationDays,
        30,
      );
      const plan = {
        code: transaction.planCode,
        name: transaction.planName,
        durationDays,
      };

      const premiumExpiryDate = await this.activatePlanForAccount(
        account,
        plan,
      );
      transaction.startsAt = new Date();
      transaction.expiresAt = premiumExpiryDate;
      await transaction.save();

      return {
        transaction,
        premiumExpiryDate,
        alreadyConfirmed: false,
      };
    }

    await transaction.save();
    return {
      transaction,
      premiumExpiryDate: account.premiumExpiryDate,
      alreadyConfirmed: false,
    };
  }

  mapTransaction(transaction, currency) {
    return {
      _id: transaction._id,
      amount: transaction.amount,
      currency: currency || "VND",
      orderInfo: transaction.orderInfo,
      status: transaction.status,
      transactionType: transaction.transactionType,
      planCode: transaction.planCode,
      planName: transaction.planName,
      planDurationDays: transaction.planDurationDays,
      startsAt: transaction.startsAt || null,
      expiresAt: transaction.expiresAt || null,
      isMock: Boolean(transaction.isMock),
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  getVNPayClient() {
    if (this.vnpayClient) return this.vnpayClient;

    if (!process.env.VNPAY_SECURE_SECRET || !process.env.VNPAY_TMN_CODE) {
      throw {
        statusCode: 503,
        message:
          "Thiếu cấu hình VNPay. Vui lòng set VNPAY_SECURE_SECRET và VNPAY_TMN_CODE",
      };
    }

    const isTestMode =
      String(process.env.VNPAY_TEST_MODE || "true").toLowerCase() !== "false";

    this.vnpayClient = new VNPay({
      secureSecret: process.env.VNPAY_SECURE_SECRET,
      tmnCode: process.env.VNPAY_TMN_CODE,
      testMode: isTestMode,
    });

    return this.vnpayClient;
  }

  getVNPayReturnUrl() {
    if (process.env.VNPAY_RETURN_URL) return process.env.VNPAY_RETURN_URL;

    const port = process.env.PORT || 5000;
    return `http://localhost:${port}/vnpay-return`;
  }

  extractRawQueryString(rawUrl = "") {
    const raw = String(rawUrl || "").trim();
    if (!raw) return "";
    if (raw.startsWith("?")) return raw.slice(1);
    const questionMarkIndex = raw.indexOf("?");
    if (questionMarkIndex < 0) return "";
    return raw.slice(questionMarkIndex + 1);
  }

  decodeFormComponent(value = "") {
    const rawValue = String(value ?? "");
    try {
      return decodeURIComponent(rawValue.replace(/\+/g, "%20"));
    } catch (error) {
      return rawValue;
    }
  }

  parseRawVNPayQuery(rawUrl = "") {
    const rawQuery = this.extractRawQueryString(rawUrl);
    if (!rawQuery) {
      return [];
    }

    return rawQuery
      .split("&")
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        const keyRaw = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
        const valueRaw = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : "";

        return {
          keyRaw,
          valueRaw,
          key: this.decodeFormComponent(keyRaw),
          value: this.decodeFormComponent(valueRaw),
        };
      })
      .filter((entry) => entry.keyRaw);
  }

  buildVNPayVerifyInput(query = {}, rawUrl = "") {
    const rawPairs = this.parseRawVNPayQuery(rawUrl);

    if (rawPairs.length > 0) {
      const parsedQuery = {};
      rawPairs.forEach((pair) => {
        parsedQuery[pair.key] = pair.value;
      });

      const signData = rawPairs
        .filter(
          (pair) =>
            pair.key !== "vnp_SecureHash" && pair.key !== "vnp_SecureHashType",
        )
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((pair) => `${pair.keyRaw}=${pair.valueRaw}`)
        .join("&");

      return {
        parsedQuery,
        signData,
        receivedHash: String(parsedQuery.vnp_SecureHash || "").trim(),
      };
    }

    const parsedQuery = { ...(query || {}) };
    const sortedKeys = Object.keys(parsedQuery)
      .filter(
        (key) =>
          key !== "vnp_SecureHash" &&
          key !== "vnp_SecureHashType" &&
          parsedQuery[key] !== undefined &&
          parsedQuery[key] !== null &&
          parsedQuery[key] !== "",
      )
      .sort();
    const params = new URLSearchParams();
    sortedKeys.forEach((key) => {
      params.append(key, String(parsedQuery[key]));
    });

    return {
      parsedQuery,
      signData: params.toString(),
      receivedHash: String(parsedQuery.vnp_SecureHash || "").trim(),
    };
  }

  verifyVNPaySignature(query = {}, rawUrl = "") {
    const secret = String(process.env.VNPAY_SECURE_SECRET || "").trim();
    if (!secret) {
      throw {
        statusCode: 503,
        message: "Thiếu cấu hình VNPay secure secret để verify chữ ký",
      };
    }

    const { parsedQuery, signData, receivedHash } = this.buildVNPayVerifyInput(
      query,
      rawUrl,
    );

    const calculatedHash = crypto
      .createHmac("sha512", secret)
      .update(Buffer.from(signData, "utf-8"))
      .digest("hex");

    const normalizedAmount = Number(parsedQuery.vnp_Amount);
    const responseCode = String(parsedQuery.vnp_ResponseCode || "").trim();

    return {
      ...parsedQuery,
      vnp_Amount: Number.isFinite(normalizedAmount)
        ? normalizedAmount / 100
        : parsedQuery.vnp_Amount,
      isVerified:
        calculatedHash.toLowerCase() === receivedHash.trim().toLowerCase(),
      isSuccess: responseCode === "00",
    };
  }

  async startVNPayCheckout(
    userId,
    {
      planCode,
      bankCode,
      locale = "vn",
      orderInfo,
      ipAddr = "127.0.0.1",
      orderType = ProductCode.Other,
    } = {},
  ) {
    const [{ account }, { plan, config }] = await Promise.all([
      this.getAccountByUserId(userId),
      this.getPlanByCode(planCode),
    ]);
    await this.ensureCanStartPremiumCheckout(account);

    const normalizedOrderInfo =
      String(orderInfo || "").trim() ||
      `Thanh toan goi Premium ${plan.name} (${plan.durationDays} ngay)`;

    const transaction = await Transaction.create({
      accountId: account._id,
      amount: plan.price,
      orderInfo: normalizedOrderInfo,
      status: TRANSACTION_STATUS.PENDING,
      transactionType: "premium_purchase",
      paymentProvider: "vnpay",
      paymentMethod: bankCode ? `vnpay_${bankCode}` : "vnpay",
      planCode: plan.code,
      planName: plan.name,
      planDurationDays: plan.durationDays,
      isMock: false,
      metadata: {
        flow: "vnpay_checkout",
      },
    });

    const txnRef = String(transaction._id);
    const vnpay = this.getVNPayClient();
    const paymentUrl = vnpay.buildPaymentUrl({
      vnp_Amount: plan.price,
      vnp_IpAddr: ipAddr,
      vnp_OrderInfo: normalizedOrderInfo,
      vnp_ReturnUrl: this.getVNPayReturnUrl(),
      vnp_TxnRef: txnRef,
      vnp_BankCode: bankCode || undefined,
      vnp_Locale: String(locale || "vn").toLowerCase() === "en" ? "en" : "vn",
      vnp_OrderType: orderType || ProductCode.Other,
    });

    transaction.metadata = {
      ...(transaction.metadata || {}),
      vnpTxnRef: txnRef,
      vnpBankCode: bankCode || null,
      vnpLocale: locale || "vn",
      vnpReturnUrl: this.getVNPayReturnUrl(),
    };
    await transaction.save();

    return {
      paymentUrl,
      transaction: this.mapTransaction(transaction, config.currency),
      plan,
      currency: config.currency,
    };
  }

  async processVNPayVerification(verify, { source = "return" } = {}) {
    const txnRef = String(verify?.vnp_TxnRef || "").trim();
    if (!txnRef || !mongoose.isValidObjectId(txnRef)) {
      return { code: "ORDER_NOT_FOUND", transaction: null };
    }

    const transaction = await Transaction.findOne({
      _id: txnRef,
      transactionType: "premium_purchase",
      paymentProvider: "vnpay",
    });

    if (!transaction) {
      return { code: "ORDER_NOT_FOUND", transaction: null };
    }

    if (Number(verify.vnp_Amount) !== Number(transaction.amount)) {
      return { code: "INVALID_AMOUNT", transaction };
    }

    if (transaction.status === TRANSACTION_STATUS.SUCCESS) {
      return {
        code: "ALREADY_CONFIRMED",
        transaction,
      };
    }

    if (!verify.isSuccess) {
      if (transaction.status === TRANSACTION_STATUS.PENDING) {
        transaction.status = TRANSACTION_STATUS.FAILED;
        transaction.confirmedAt = new Date();
        transaction.metadata = {
          ...(transaction.metadata || {}),
          vnpLastSource: source,
          vnpLastResponseCode: verify.vnp_ResponseCode || "",
          vnpLastTxnStatus: verify.vnp_TransactionStatus || "",
        };
        await transaction.save();
      }

      return {
        code: "PAYMENT_FAILED",
        transaction,
      };
    }

    const account = await Account.findById(transaction.accountId);
    if (!account) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy tài khoản cho giao dịch",
      };
    }

    const durationDays = this.toPositiveInteger(
      transaction.planDurationDays,
      30,
    );
    const plan = {
      code: transaction.planCode,
      name: transaction.planName,
      durationDays,
    };

    const premiumExpiryDate = await this.activatePlanForAccount(account, plan);

    transaction.status = TRANSACTION_STATUS.SUCCESS;
    transaction.confirmedAt = new Date();
    transaction.startsAt = new Date();
    transaction.expiresAt = premiumExpiryDate;
    transaction.metadata = {
      ...(transaction.metadata || {}),
      vnpLastSource: source,
      vnpLastResponseCode: verify.vnp_ResponseCode || "",
      vnpLastTxnStatus: verify.vnp_TransactionStatus || "",
      vnpTransactionNo: verify.vnp_TransactionNo || "",
      vnpBankTranNo: verify.vnp_BankTranNo || "",
      vnpPayDate: verify.vnp_PayDate || "",
    };
    await transaction.save();

    return {
      code: "SUCCESS",
      transaction,
      premiumExpiryDate,
    };
  }

  async verifyVNPayReturn(query = {}, { rawQueryString = "" } = {}) {
    this.getVNPayClient();
    const verify = this.verifyVNPaySignature(query, rawQueryString);
    const processing = verify.isVerified
      ? await this.processVNPayVerification(verify, { source: "return" })
      : { code: "INVALID_SIGNATURE", transaction: null };
    const parsedPayDate = parseDate(verify.vnp_PayDate || "Invalid Date");

    return {
      verify,
      processing,
      payDate: Number.isNaN(parsedPayDate.getTime())
        ? null
        : parsedPayDate.toISOString(),
    };
  }

  async verifyVNPayIpn(query = {}, { rawQueryString = "" } = {}) {
    try {
      this.getVNPayClient();
      const verify = this.verifyVNPaySignature(query, rawQueryString);
      if (!verify.isVerified) {
        return {
          verify,
          ipnResponse: IpnFailChecksum,
          processing: { code: "INVALID_SIGNATURE", transaction: null },
        };
      }

      const processing = await this.processVNPayVerification(verify, {
        source: "ipn",
      });

      if (processing.code === "ORDER_NOT_FOUND") {
        return { verify, ipnResponse: IpnOrderNotFound, processing };
      }

      if (processing.code === "INVALID_AMOUNT") {
        return { verify, ipnResponse: IpnInvalidAmount, processing };
      }

      if (processing.code === "ALREADY_CONFIRMED") {
        return { verify, ipnResponse: InpOrderAlreadyConfirmed, processing };
      }

      if (
        processing.code === "SUCCESS" ||
        processing.code === "PAYMENT_FAILED"
      ) {
        return { verify, ipnResponse: IpnSuccess, processing };
      }

      return { verify, ipnResponse: IpnUnknownError, processing };
    } catch (error) {
      return {
        verify: null,
        ipnResponse: IpnUnknownError,
        processing: {
          code: "UNKNOWN_ERROR",
          message: error?.message || "Unknown error",
        },
      };
    }
  }

  async getPremiumHistory(
    userId,
    { page = 1, limit = 10, includePending = false } = {},
  ) {
    const { account } = await this.getAccountByUserId(userId);
    const config = await this.getOrCreatePremiumConfig();
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const filter = {
      accountId: account._id,
      transactionType: "premium_purchase",
    };
    if (!includePending) {
      filter.status = { $in: [TRANSACTION_STATUS.SUCCESS, TRANSACTION_STATUS.FAILED] };
    }

    const [items, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return {
      items: items.map((item) => this.mapTransaction(item, config.currency)),
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
      hasNext: skip + parsedLimit < total,
      hasPrev: parsedPage > 1,
    };
  }

  async getPremiumOverview(userId) {
    const [access, historySummary] = await Promise.all([
      this.getAccessContextByUserId(userId),
      this.getPremiumHistory(userId, { page: 1, limit: 5 }),
    ]);

    return {
      account: {
        userId: access.user._id,
        accountId: access.account._id,
        displayName: access.user.displayName,
        avatar: access.user.avatar,
      },
      premium: {
        isPremium: access.isPremiumActive,
        tier: access.tier,
        tierName: access.tierName,
        premiumExpiryDate: access.premiumExpiryDate,
        features: access.features,
        limits: access.limits,
      },
      plans: {
        currency: access.config.currency,
        defaultPlanCode: access.config.defaultPlanCode,
        items: access.config.plans || [],
      },
      paymentTemplate: access.config.paymentTemplate || {},
      recentTransactions: historySummary.items,
    };
  }
}

module.exports = new PremiumService();
