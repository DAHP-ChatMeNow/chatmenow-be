const Account = require("../models/account.model");
const Post = require("../models/post.model");
const premiumService = require("./premium.service");

const buildStartOfToday = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
};

async function getAdminStats() {
  const startOfToday = buildStartOfToday();

  const [
    totalUsers,
    activeUsers,
    totalPosts,
    pendingPosts,
    newUsersToday,
    newPostsToday,
  ] = await Promise.all([
    Account.countDocuments({}),
    Account.countDocuments({ accountStatus: "active" }),
    Post.countDocuments({}),
    Post.countDocuments({ status: "pending" }),
    Account.countDocuments({ createdAt: { $gte: startOfToday } }),
    Post.countDocuments({ createdAt: { $gte: startOfToday } }),
  ]);

  return {
    totalUsers,
    activeUsers,
    totalPosts,
    pendingPosts,
    newUsersToday,
    newPostsToday,
  };
}

async function getPremiumConfig() {
  return await premiumService.getOrCreatePremiumConfig();
}

async function updatePremiumConfig(payload) {
  return await premiumService.savePremiumConfig(payload || {});
}

module.exports = {
  getAdminStats,
  getPremiumConfig,
  updatePremiumConfig,
};
