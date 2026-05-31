/**
 * railwayWatchdog.js
 *
 * Handles Railway deployment webhook events.
 *
 * Flow:
 *   Railway fires webhook → fetchDeploymentLogs() → analyzeWithClaude()
 *   → sendMail() with diagnosis + suggested fix
 *
 * Required env vars (set in Railway):
 *   RAILWAY_API_TOKEN        — Railway API token (from Railway dashboard → Account Settings → Tokens)
 *   RAILWAY_WEBHOOK_SECRET   — A secret string you choose; set the same value in Railway webhook config
 *   ANTHROPIC_API_KEY        — Anthropic API key
 *   WATCHDOG_ALERT_EMAIL     — Where to send failure alerts (e.g. your email)
 *
 * Railway GraphQL API docs: https://docs.railway.app/reference/public-api
 */

const crypto  = require("crypto");
const https   = require("https");
const { sendMail } = require("./emailService");

// ── Constants ────────────────────────────────────────────────────────────────

const RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // fast + cheap for log analysis

// ── Webhook signature verification ───────────────────────────────────────────

/**
 * Verifies the Railway webhook signature.
 * Railway signs the raw body with HMAC-SHA256 using your RAILWAY_WEBHOOK_SECRET.
 * @param {string} rawBody   - raw request body string (before JSON.parse)
 * @param {string} signature - value of the X-Railway-Signature header
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  const secret = process.env.RAILWAY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[watchdog] RAILWAY_WEBHOOK_SECRET not set — skipping signature check");
    return true; // allow in dev; enforce in prod
  }
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── Railway API helpers ───────────────────────────────────────────────────────

/**
 * Makes a GraphQL request to the Railway API.
 * @param {string} query
 * @param {object} variables
 * @returns {Promise<object>}
 */
async function railwayGraphQL(query, variables = {}) {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) throw new Error("RAILWAY_API_TOKEN is not set");

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    };
    const req = https.request(RAILWAY_API_URL, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
          else resolve(parsed.data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Fetches the build + runtime logs for a given deployment.
 * Returns a trimmed string of the most relevant log lines.
 * @param {string} deploymentId
 * @returns {Promise<string>}
 */
async function fetchDeploymentLogs(deploymentId) {
  const query = `
    query DeploymentLogs($deploymentId: String!) {
      deploymentLogs(deploymentId: $deploymentId) {
        timestamp
        severity
        message
      }
    }
  `;
  try {
    const data = await railwayGraphQL(query, { deploymentId });
    const logs = (data.deploymentLogs || []);

    // Focus on errors and the lines immediately around them
    const lines = logs.map(l => `[${l.severity}] ${l.message}`);

    // Return last 200 lines max — enough context without flooding the prompt
    return lines.slice(-200).join("\n") || "(no logs retrieved)";
  } catch (err) {
    return `(log fetch failed: ${err.message})`;
  }
}

// ── Claude analysis ───────────────────────────────────────────────────────────

/**
 * Sends deployment logs to Claude for analysis and fix suggestions.
 * @param {object} opts
 * @param {string} opts.logs         - raw log output
 * @param {string} opts.deploymentId
 * @param {string} opts.serviceName
 * @param {string} opts.status       - "FAILED" | "CRASHED"
 * @returns {Promise<string>}        - Claude's analysis as plain text
 */
async function analyzeWithClaude({ logs, deploymentId, serviceName, status }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "(ANTHROPIC_API_KEY not set — skipping AI analysis)";

  const prompt = `You are a deployment engineer reviewing a failed Railway deployment.

Service: ${serviceName}
Deployment ID: ${deploymentId}
Status: ${status}

DEPLOYMENT LOGS:
\`\`\`
${logs}
\`\`\`

Provide a concise diagnosis in this exact format:

## Root cause
One or two sentences identifying the specific error.

## Likely fix
The concrete change needed (file path, code snippet if possible, or config step).

## Confidence
High / Medium / Low — and why.

Keep it short. A developer will act on this immediately.`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };

    const req = https.request(ANTHROPIC_API_URL, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.content?.[0]?.text || "(no response from Claude)";
          resolve(text);
        } catch {
          resolve("(failed to parse Claude response)");
        }
      });
    });

    req.on("error", () => resolve("(Claude API request failed)"));
    req.write(body);
    req.end();
  });
}

// ── Notification ──────────────────────────────────────────────────────────────

/**
 * Sends an alert email with the diagnosis.
 */
async function notifyFailure({ serviceName, deploymentId, status, logs, analysis, deploymentUrl }) {
  const to = process.env.WATCHDOG_ALERT_EMAIL;
  if (!to) {
    console.warn("[watchdog] WATCHDOG_ALERT_EMAIL not set — skipping email alert");
    return;
  }

  const subject = `🚨 Deploy ${status.toLowerCase()}: ${serviceName}`;
  const html = `
    <h2 style="color:#be123c">Deployment ${status}: ${serviceName}</h2>
    <p><strong>Deployment ID:</strong> ${deploymentId}</p>
    ${deploymentUrl ? `<p><a href="${deploymentUrl}">View in Railway →</a></p>` : ""}

    <hr/>
    <h3>AI Diagnosis</h3>
    <pre style="background:#f8f6f3;padding:16px;border-radius:6px;white-space:pre-wrap">${analysis}</pre>

    <hr/>
    <h3>Raw Logs (last 200 lines)</h3>
    <pre style="background:#1c1917;color:#f8f6f3;padding:16px;border-radius:6px;font-size:12px;white-space:pre-wrap;overflow-x:auto">${logs.replace(/</g, "&lt;")}</pre>
  `;

  await sendMail({ to, subject, html });
  console.log(`[watchdog] Alert sent to ${to} for deployment ${deploymentId}`);
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Processes a Railway webhook payload.
 * Call this from the webhook route handler after signature verification.
 *
 * Railway webhook payload shape (simplified):
 * {
 *   type: "DEPLOY",
 *   status: "SUCCESS" | "FAILED" | "CRASHED",
 *   deployment: {
 *     id: string,
 *     url: string,
 *     meta: { serviceName: string, ... }
 *   }
 * }
 */
async function handleWebhook(payload) {
  const { type, status } = payload;

  // Only react to deployment failures
  if (type !== "DEPLOY" || (status !== "FAILED" && status !== "CRASHED")) {
    console.log(`[watchdog] Ignoring event type=${type} status=${status}`);
    return;
  }

  const deploymentId  = payload.deployment?.id;
  const serviceName   = payload.deployment?.meta?.serviceName || "unknown service";
  const deploymentUrl = payload.deployment?.url;

  console.log(`[watchdog] Deploy ${status} for ${serviceName} (${deploymentId}) — starting analysis`);

  // Run log fetch and analysis in parallel isn't possible — we need logs first
  const logs     = await fetchDeploymentLogs(deploymentId);
  const analysis = await analyzeWithClaude({ logs, deploymentId, serviceName, status });

  await notifyFailure({ serviceName, deploymentId, status, logs, analysis, deploymentUrl });
}

module.exports = { handleWebhook, verifySignature };
