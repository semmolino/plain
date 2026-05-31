/**
 * webhooks.js — Public webhook routes (no JWT auth)
 *
 * Mount this BEFORE authMiddleware in server.js:
 *   app.use("/api/v1/webhooks", webhookRoutes);
 *
 * Railway webhook setup:
 *   1. Go to Railway project → Settings → Webhooks
 *   2. URL: https://your-app.railway.app/api/v1/webhooks/railway
 *   3. Secret: set RAILWAY_WEBHOOK_SECRET env var to the same value
 *   4. Events: Deploy (success + failure)
 */

const express = require("express");
const { handleWebhook, verifySignature } = require("../services/railwayWatchdog");

const router = express.Router();

// Raw body parser for this route so we can verify the HMAC signature
// (express.json() consumes the body before we can hash it)
router.use(express.raw({ type: "application/json" }));

/**
 * POST /api/v1/webhooks/railway
 * Receives Railway deployment events.
 */
router.post("/railway", async (req, res) => {
  const rawBody  = req.body.toString("utf8");
  const signature = req.headers["x-railway-signature"] || "";

  // Verify signature — reject if it doesn't match
  if (!verifySignature(rawBody, signature)) {
    console.warn("[webhooks] Invalid Railway signature — request rejected");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Respond immediately — Railway expects a fast 2xx
  res.status(200).json({ received: true });

  // Process asynchronously so we don't hold up the webhook response
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[webhooks] Failed to parse Railway payload:", err.message);
    return;
  }

  handleWebhook(payload).catch((err) => {
    console.error("[watchdog] handleWebhook error:", err.message);
  });
});

module.exports = router;
