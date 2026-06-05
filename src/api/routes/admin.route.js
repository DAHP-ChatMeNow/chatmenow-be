const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin.controller");
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");

router.get("/stats", verifyToken, requireAdmin, adminController.getStats);
router.get(
  "/premium/config",
  verifyToken,
  requireAdmin,
  adminController.getPremiumConfig,
);
router.put(
  "/premium/config",
  verifyToken,
  requireAdmin,
  adminController.updatePremiumConfig,
);
router.get(
  "/premium/plans",
  verifyToken,
  requireAdmin,
  adminController.getPremiumPlans,
);
router.post(
  "/premium/plans",
  verifyToken,
  requireAdmin,
  adminController.createPremiumPlan,
);
router.put(
  "/premium/plans/:planCode",
  verifyToken,
  requireAdmin,
  adminController.updatePremiumPlan,
);
router.delete(
  "/premium/plans/:planCode",
  verifyToken,
  requireAdmin,
  adminController.deletePremiumPlan,
);
router.patch(
  "/premium/plans/:planCode/default",
  verifyToken,
  requireAdmin,
  adminController.setDefaultPremiumPlan,
);

// Quản lý bạn bè của người dùng (Admin)
router.delete("/users/:userId/friends/:friendId", verifyToken, requireAdmin, adminController.removeUserFriend);

module.exports = router;
