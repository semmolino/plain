"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { consoleAuth } = require("./middleware/consoleAuth");

const app = express();
const port = process.env.CONSOLE_PORT || 4000;

// Reverse-Proxy (Railway): echte Client-IP für Rate-Limiting.
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json());

// CORS-Allowlist für die Konsolen-UI.
const origins = (process.env.CONSOLE_ORIGINS || "http://localhost:4173").split(",").map((s) => s.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === "production";
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origins.includes(origin)) return cb(null, true);
    if (!isProd && /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.get("/health", (_req, res) => res.json({ ok: true, service: "owner-console" }));

// Öffentlich: nur Login
app.use("/api/console/auth", require("./routes/auth"));

// Geschützt: gültiges Konsolen-Token erforderlich
app.use("/api/console", consoleAuth, require("./routes/catalog"));
app.use("/api/console", consoleAuth, require("./routes/plans"));
app.use("/api/console", consoleAuth, require("./routes/tenants"));

app.listen(port, () => console.log(`✅ Owner-Konsole läuft auf Port ${port}`));
