const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");
const dns = require("node:dns/promises");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const connectDB = async () => {
  try {
    // 👉 Force DNS server
    dns.setServers(["1.1.1.1", "8.8.8.8"]);

    const conn = await mongoose.connect(process.env.MONGO_URI);

    console.log(`MongoDB đã kết nối thành công: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Lỗi kết nối MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;