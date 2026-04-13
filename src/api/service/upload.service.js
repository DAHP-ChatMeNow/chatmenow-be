const {
  uploadToS3,
  getSignedUrlFromS3,
  getSignedUploadUrlFromS3,
} = require("../middleware/storage");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = require("../../config/s3");
const User = require("../models/user.model");
const { generateDefaultAvatar } = require("../../utils/avatar.helper");
const path = require("path");

class UploadService {
  sanitizeFileName(fileName = "file") {
    const baseName = path.basename(String(fileName || "file"));
    return baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  buildUploadKey(folder, userId, fileName) {
    const safeFolder = String(folder || "chat-media").replace(
      /[^a-zA-Z0-9/_-]/g,
      "",
    );
    const safeFileName = this.sanitizeFileName(fileName);
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `${safeFolder}/${userId}/${Date.now()}-${randomPart}-${safeFileName}`;
  }

  validateChatAttachmentUpload(contentType, fileSize) {
    const safeSize = Number(fileSize || 0);
    if (!contentType) {
      throw {
        statusCode: 400,
        message: "Thiếu contentType",
      };
    }

    if (!Number.isFinite(safeSize) || safeSize <= 0) {
      throw {
        statusCode: 400,
        message: "fileSize không hợp lệ",
      };
    }

    const rules = [
      { prefix: "image/", maxSize: 10 * 1024 * 1024 },
      { prefix: "audio/", maxSize: 20 * 1024 * 1024 },
      { prefix: "application/", maxSize: 50 * 1024 * 1024 },
      { prefix: "text/", maxSize: 10 * 1024 * 1024 },
      { prefix: "video/", maxSize: 30 * 1024 * 1024 },
    ];

    const matchedRule = rules.find((rule) =>
      contentType.startsWith(rule.prefix),
    );
    if (!matchedRule) {
      throw {
        statusCode: 400,
        message: "Loại file chưa được hỗ trợ",
      };
    }

    if (safeSize > matchedRule.maxSize) {
      throw {
        statusCode: 400,
        message: "Dung lượng file vượt quá giới hạn cho loại này",
      };
    }
  }

  async createChatAttachmentUpload({
    userId,
    fileName,
    contentType,
    fileSize,
  }) {
    const safeFileName = this.sanitizeFileName(fileName);
    this.validateChatAttachmentUpload(contentType, fileSize);

    const key = this.buildUploadKey("chat-media", userId, safeFileName);
    const uploadUrl = await getSignedUploadUrlFromS3(key, contentType);

    return {
      key,
      uploadUrl,
      method: "PUT",
      contentType,
      expiresIn: 600,
    };
  }

  async uploadAvatar(userId, file) {
    if (!file) {
      throw {
        statusCode: 400,
        message: "Không tìm thấy file ảnh",
      };
    }

    const s3Key = await uploadToS3(file, "avatars");
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar: s3Key },
      { new: true },
    );

    if (!updatedUser) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy user",
      };
    }

    return updatedUser;
  }

  async deleteAvatar(userId) {
    const user = await User.findById(userId);

    if (!user) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy user",
      };
    }

    if (user.avatar && !user.avatar.startsWith("http")) {
      try {
        const deleteParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: user.avatar,
        };
        const command = new DeleteObjectCommand(deleteParams);
        await s3Client.send(command);
      } catch (error) {
        console.error("Lỗi khi xóa avatar từ S3:", error.message);
      }
    }

    const defaultAvatar = generateDefaultAvatar(user.displayName);
    // Default avatar
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar: defaultAvatar },
      { new: true },
    );

    return updatedUser;
  }

  async createReelVideoUpload({ userId, fileName, contentType, fileSize }) {
    if (!contentType || !contentType.startsWith("video/")) {
      throw { statusCode: 400, message: "Chỉ chấp nhận file video" };
    }

    const MAX_REEL_SIZE = 200 * 1024 * 1024; // 200 MB
    if (!fileSize || Number(fileSize) > MAX_REEL_SIZE) {
      throw { statusCode: 400, message: "Dung lượng video tối đa 200MB" };
    }

    const key = this.buildUploadKey("reels", userId, fileName || "reel.mp4");
    const uploadUrl = await getSignedUploadUrlFromS3(key, contentType);

    return {
      key,
      uploadUrl,
      method: "PUT",
      contentType,
      expiresIn: 900, // 15 minutes
    };
  }

  async getPresignedUrl(key) {
    if (!key) {
      throw {
        statusCode: 400,
        message: "Thiếu tham số key",
      };
    }

    const signedUrl = await getSignedUrlFromS3(key);

    if (!signedUrl) {
      throw {
        statusCode: 404,
        message: "Không tìm thấy file",
      };
    }

    return {
      viewUrl: signedUrl,
      key: key,
      expiresIn: 3600, // seconds (1 hour)
    };
  }
}

module.exports = new UploadService();
