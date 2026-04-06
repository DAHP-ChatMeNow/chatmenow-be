const adminService = require("../service/admin.service");

exports.getStats = async (req, res) => {
  try {
    const stats = await adminService.getAdminStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};
