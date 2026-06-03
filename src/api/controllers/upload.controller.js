const uploadService = require("../service/upload.service");
const User = require("../models/user.model");

// Upload avatar to S3
const uploadImage = async (req, res) => {
  try {
    const updatedUser = await uploadService.uploadAvatar(
      req.user.userId,
      req.file,
    );

    const io = req.app.get("io");
    if (io) {
      const authorUser = await User.findById(req.user.userId).select("friends").lean();
      const friends = authorUser?.friends || [];
      const payload = {
        userId: req.user.userId,
        avatar: updatedUser.avatar,
        displayName: updatedUser.displayName,
        coverImage: updatedUser.coverImage,
      };
      io.to(req.user.userId.toString()).emit("user:profile-updated", payload);
      friends.forEach((friendId) => {
        io.to((friendId._id || friendId).toString()).emit("user:profile-updated", payload);
      });
    }

    res.status(200).json({
      msg: "Upload avatar thành công",
      user: {
        ...updatedUser.toObject(),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res
      .status(500)
      .json({ msg: "Lỗi server khi upload avatar", error: err.message });
  }
};

// Delete avatar và reset về avatar mặc định
const deleteAvatar = async (req, res) => {
  try {
    const updatedUser = await uploadService.deleteAvatar(req.user.userId);

    const io = req.app.get("io");
    if (io) {
      const authorUser = await User.findById(req.user.userId).select("friends").lean();
      const friends = authorUser?.friends || [];
      const payload = {
        userId: req.user.userId,
        avatar: updatedUser.avatar,
        displayName: updatedUser.displayName,
        coverImage: updatedUser.coverImage,
      };
      io.to(req.user.userId.toString()).emit("user:profile-updated", payload);
      friends.forEach((friendId) => {
        io.to((friendId._id || friendId).toString()).emit("user:profile-updated", payload);
      });
    }

    res.status(200).json({
      msg: "Đã xóa avatar và reset về avatar mặc định",
      user: {
        ...updatedUser.toObject(),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res
      .status(500)
      .json({ msg: "Lỗi server khi xóa avatar", error: err.message });
  }
};

const getPresignedUrl = async (req, res) => {
  try {
    const result = await uploadService.getPresignedUrl(req.query.key);
    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res
      .status(500)
      .json({ msg: "Lỗi server khi tạo presigned URL", error: err.message });
  }
};

const getChatAttachmentUploadUrl = async (req, res) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const result = await uploadService.createChatAttachmentUpload({
      userId: req.user.userId,
      fileName,
      contentType,
      fileSize,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res.status(500).json({
      msg: "Lỗi server khi tạo upload URL cho file chat",
      error: err.message,
    });
  }
};

// Upload cover image to S3
const uploadCoverImage = async (req, res) => {
  try {
    const updatedUser = await uploadService.uploadCoverImage(
      req.user.userId,
      req.file,
    );

    const io = req.app.get("io");
    if (io) {
      const authorUser = await User.findById(req.user.userId).select("friends").lean();
      const friends = authorUser?.friends || [];
      const payload = {
        userId: req.user.userId,
        avatar: updatedUser.avatar,
        displayName: updatedUser.displayName,
        coverImage: updatedUser.coverImage,
      };
      io.to(req.user.userId.toString()).emit("user:profile-updated", payload);
      friends.forEach((friendId) => {
        io.to((friendId._id || friendId).toString()).emit("user:profile-updated", payload);
      });
    }

    res.status(200).json({
      msg: "Upload ảnh bìa thành công",
      user: {
        ...updatedUser.toObject(),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res
      .status(500)
      .json({ msg: "Lỗi server khi upload ảnh bìa", error: err.message });
  }
};

const getReelVideoUploadUrl = async (req, res) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const result = await uploadService.createReelVideoUpload({
      userId: req.user.userId,
      fileName,
      contentType,
      fileSize,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res.status(500).json({
      msg: "Lỗi server khi tạo upload URL cho reel video",
      error: err.message,
    });
  }
};

// Delete cover image
const deleteCoverImage = async (req, res) => {
  try {
    const updatedUser = await uploadService.deleteCoverImage(req.user.userId);

    const io = req.app.get("io");
    if (io) {
      const authorUser = await User.findById(req.user.userId).select("friends").lean();
      const friends = authorUser?.friends || [];
      const payload = {
        userId: req.user.userId,
        avatar: updatedUser.avatar,
        displayName: updatedUser.displayName,
        coverImage: updatedUser.coverImage,
      };
      io.to(req.user.userId.toString()).emit("user:profile-updated", payload);
      friends.forEach((friendId) => {
        io.to((friendId._id || friendId).toString()).emit("user:profile-updated", payload);
      });
    }

    res.status(200).json({
      msg: "Đã xóa ảnh bìa",
      user: {
        ...updatedUser.toObject(),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res
      .status(500)
      .json({ msg: "Lỗi server khi xóa ảnh bìa", error: err.message });
  }
};

const getPresignedPutUrl = async (req, res) => {
  try {
    const { folder, fileName, contentType, fileSize } = req.body || {};
    const result = await uploadService.createGenericPresignedPutUrl({
      userId: req.user.userId,
      folder,
      fileName,
      contentType,
      fileSize,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ msg: err.message });
    }
    res.status(500).json({
      msg: "Lỗi server khi tạo presigned upload URL",
      error: err.message,
    });
  }
};

module.exports = {
  uploadImage,
  deleteAvatar,
  getPresignedUrl,
  getChatAttachmentUploadUrl,
  uploadCoverImage,
  deleteCoverImage,
  getReelVideoUploadUrl,
  getPresignedPutUrl,
};
