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

async function getPremiumPlans() {
  return await premiumService.getPremiumPlansForAdmin();
}

async function createPremiumPlan(payload) {
  return await premiumService.createPremiumPlan(payload || {});
}

async function updatePremiumPlan(planCode, payload) {
  return await premiumService.updatePremiumPlan(planCode, payload || {});
}

async function deletePremiumPlan(planCode) {
  return await premiumService.deletePremiumPlan(planCode);
}

async function setDefaultPremiumPlan(planCode) {
  return await premiumService.setDefaultPremiumPlan(planCode);
}

module.exports = {
  getAdminStats,
  getPremiumConfig,
  updatePremiumConfig,
  getPremiumPlans,
  createPremiumPlan,
  updatePremiumPlan,
  deletePremiumPlan,
  setDefaultPremiumPlan,
};
