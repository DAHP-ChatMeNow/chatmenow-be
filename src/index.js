const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const routes = require("./api/routes/index");
const initializeSocket = require("./sockets/socket.handler");
const { setNotificationIo } = require("./utils/realtime-notification.helper");
const { apiKeyMiddleware } = require("./api/middleware/apiKeyMiddleware");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
connectDB();

const defaultMobileOrigins = [
  "http://localhost",
  "https://localhost",
  "capacitor://localhost",
];

const envAllowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

const allowedOrigins = new Set([...defaultMobileOrigins, ...envAllowedOrigins]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  credentials: true,
  optionsSuccessStatus: 204,
  preflightContinue: false,
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions,
});

app.set("io", io);
setNotificationIo(io);

initializeSocket(io);

app.use("/api", apiKeyMiddleware, routes);

const PORT = process.env.PORT;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server đang lắng nghe trên cổng ${PORT}`);
});
