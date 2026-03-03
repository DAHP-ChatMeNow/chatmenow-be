const multer = require("multer");
const path = require("path");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3Client = require("../../config/s3");

const storage = multer.memoryStorage();

const multerUploads = multer({ storage }).single("image");

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
  uploadToS3,
  getSignedUrlFromS3,
};
