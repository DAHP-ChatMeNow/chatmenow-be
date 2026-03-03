const { uploadToS3, getSignedUrlFromS3 } = require("../middleware/storage");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = require("../../config/s3");
const User = require("../models/user.model");
const { generateDefaultAvatar } = require("../../utils/avatar.helper");

class UploadService {
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
