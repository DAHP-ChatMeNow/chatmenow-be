const multer = require("multer");
const path = require("path");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3Client = require("../../config/s3");

const storage = multer.memoryStorage();

// Middleware cho upload avatar (single file)
const multerUploads = multer({ storage }).single("image");

// Middleware cho upload media của post (multiple files - ảnh và video)
const multerPostMedia = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      cb(
        new Error(
          "Chỉ chấp nhận file ảnh (JPEG, PNG, GIF, WEBP) hoặc video (MP4, MPEG, MOV, AVI)",
        ),
      );
      return;
    }

    // Giới hạn dung lượng ảnh: 10MB
    if (file.mimetype.startsWith("image/") && file.size > 10 * 1024 * 1024) {
      cb(new Error("Dung lượng ảnh không được vượt quá 10MB"));
      return;
    }

    // Giới hạn dung lượng video: 50MB
    if (file.mimetype.startsWith("video/") && file.size > 50 * 1024 * 1024) {
      cb(new Error("Dung lượng video không được vượt quá 50MB"));
      return;
    }

    cb(null, true);
  },
}).array("media", 10); // Cho phép tối đa 10 files

// Upload file to S3
const uploadToS3 = async (file, folderPath = "avatars") => {
  const fileExtension = path.extname(file.originalname);
  const fileName = `${folderPath}/${Date.now()}-${Math.random().toString(36).substring(7)}${fileExtension}`;

  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    return fileName;
  } catch (error) {
    console.log("S3_BUCKET:", process.env.S3_BUCKET);
    console.log("AWS_REGION:", process.env.AWS_REGION);
    throw new Error(`Lỗi khi upload lên S3: ${error.message}`);
  }
};

// Get signed URL from S3 (valid for 1 hour)
const getSignedUrlFromS3 = async (key) => {
  if (!key) return null;

  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });

  try {
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    }); // 1 hour
    return signedUrl;
  } catch (error) {
    throw new Error(`Lỗi khi tạo signed URL: ${error.message}`);
  }
};

module.exports = {
  multerUploads,
  multerPostMedia,
  uploadToS3,
  getSignedUrlFromS3,
};
