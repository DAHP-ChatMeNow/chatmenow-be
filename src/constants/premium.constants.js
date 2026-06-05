const PREMIUM_SETTING_KEY = "premium_config_v1";

const PREMIUM_TIERS = {
  FREE: "free",
  PREMIUM: "premium",
};

const PREMIUM_DEFAULT_CONFIG = {
  version: 2,
  currency: "VND",
  defaultPlanCode: "premium_monthly",
  free: {
    name: "Free",
    features: {
      aiAssistant: false,
      advancedAiSummary: false,
      prioritySupport: false,
      canCreatePosts: true,
      canInteract: true,
      canUseReels: true,
      canUseStories: true,
    },
    limits: {
      postsPerDay: 3,
      reelsPerDay: 1,
      storiesPerDay: 5,
      postVideoDurationSeconds: 120,
      reelVideoDurationSeconds: 45,
      storyVideoDurationSeconds: 30,
    },
  },
  premium: {
    name: "Premium",
    features: {
      aiAssistant: true,
      advancedAiSummary: true,
      prioritySupport: true,
      canCreatePosts: true,
      canInteract: true,
      canUseReels: true,
      canUseStories: true,
    },
    limits: {
      postsPerDay: 30,
      reelsPerDay: 20,
      storiesPerDay: 30,
      postVideoDurationSeconds: 900,
      reelVideoDurationSeconds: 300,
      storyVideoDurationSeconds: 120,
    },
  },
  plans: [
    {
      code: "premium_monthly",
      title: "Gói Premium 1 tháng",
      name: "Premium 1 tháng",
      description: "Phù hợp để trải nghiệm đầy đủ tính năng nâng cao.",
      price: 99000,
      durationDays: 30,
      isRecommended: true,
      disable: false,
      benefits: [
        "Sử dụng AI Assistant",
        "Tăng giới hạn đăng bài, reel và story",
        "Ưu tiên hỗ trợ",
      ],
      features: {
        aiAssistant: true,
        advancedAiSummary: true,
        prioritySupport: true,
        canCreatePosts: true,
        canInteract: true,
        canUseReels: true,
        canUseStories: true,
      },
      limits: {
        postsPerDay: 30,
        reelsPerDay: 20,
        storiesPerDay: 30,
        postVideoDurationSeconds: 900,
        reelVideoDurationSeconds: 300,
        storyVideoDurationSeconds: 120,
      },
    },
    {
      code: "premium_quarterly",
      title: "Gói Premium 3 tháng",
      name: "Premium 3 tháng",
      description: "Tiết kiệm hơn khi dùng dài hạn.",
      price: 249000,
      durationDays: 90,
      isRecommended: false,
      disable: false,
      benefits: [
        "Sử dụng AI Assistant",
        "Tăng giới hạn đăng bài, reel và story",
        "Ưu tiên hỗ trợ",
      ],
      features: {
        aiAssistant: true,
        advancedAiSummary: true,
        prioritySupport: true,
        canCreatePosts: true,
        canInteract: true,
        canUseReels: true,
        canUseStories: true,
      },
      limits: {
        postsPerDay: 30,
        reelsPerDay: 20,
        storiesPerDay: 30,
        postVideoDurationSeconds: 900,
        reelVideoDurationSeconds: 300,
        storyVideoDurationSeconds: 120,
      },
    },
  ],
  paymentTemplate: {
    merchantName: "ChatMeNow",
    bankName: "Vietcombank",
    bankAccountNumber: "0123456789",
    bankAccountName: "CHATMENOW COMPANY",
    transferNotePrefix: "PREM",
    qrPlaceholderUrl:
      "https://dummyimage.com/512x512/ebf4ff/0b3b8f.png&text=QR+Thanh+Toan+Mau",
    supportMessage:
      "Đây là giao diện thanh toán mẫu, dữ liệu chỉ phục vụ demo trước khi tích hợp cổng thanh toán thật.",
  },
};

module.exports = {
  PREMIUM_SETTING_KEY,
  PREMIUM_TIERS,
  PREMIUM_DEFAULT_CONFIG,
};
