const express = require("express");
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const { passport, initializePassport } = require("./services/auth/passport");
const propertyRoutes = require("./routes/propertyRoutes");
const authRoutes = require("./routes/authRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const messageRoutes = require("./routes/messageRoutes");
const financeRoutes = require("./routes/financeRoutes");

const app = express();
const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000);
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret-change-me";
initializePassport();
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_IDLE_TIMEOUT_MS
  }
});

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use("/api/payments/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/properties", propertyRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/finances", financeRoutes);

module.exports = app;
module.exports.sessionMiddleware = sessionMiddleware;
