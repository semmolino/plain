"use strict";

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { consoleAuth } = require("./middleware/consoleAuth");

const app = express();
const port = process.env.CONSOLE_PORT || 4000;

// Reverse-Proxy (Railway): echte Client-IP für Rate-Limiting.
app.set("trust proxy", 1);
// CSP aus, da dieser Server auch die gebaute SPA ausliefert (Vite-Bundles).
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// CORS-Allowlist für die Konsolen-UI.
const origins = (process.env.CONSOLE_ORIGINS || "http://localhost:4173").split(",").map((s) => s.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === "production";
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origins.includes(origin)) return cb(null, true);
    if (!isProd && /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    // Nicht werfen: cb(null,false) liefert kein ACAO -> Same-Origin (eigene SPA)
    // lädt normal, echte Fremd-Origins werden vom Browser geblockt. Kein 500.
    return cb(null, false);
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
app.use("/api/console", consoleAuth, require("./routes/audit"));
app.use("/api/console", consoleAuth, require("./routes/suggestions"));
app.use("/api/console", consoleAuth, require("./routes/serviceRequests"));

// Gebaute Web-UI ausliefern (ein Server für UI + API). Falls noch nicht gebaut:
// `npm --prefix web run build`.
const WEB_DIST = path.join(__dirname, "web", "dist");
if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
} else {
  console.warn("[owner-console] web/dist fehlt — UI nicht gebaut. Nur API verfügbar.");
}

app.listen(port, () => console.log(`✅ Owner-Konsole läuft auf http://localhost:${port}`));
