"use strict";

const svc = require("../services/push");

// GET /api/v1/push/public-key
// Liefert den öffentlichen VAPID-Schlüssel (applicationServerKey) fürs Frontend.
// { enabled: false } wenn serverseitig keine Keys konfiguriert sind.
async function publicKey(req, res) {
  const key = svc.getPublicKey();
  return res.json({ enabled: !!key, publicKey: key });
}

// POST /api/v1/push/subscribe
// Body: { subscription: PushSubscriptionJSON }
async function subscribe(req, res, supabase) {
  try {
    await svc.saveSubscription(supabase, {
      tenantId:     req.tenantId,
      userId:       req.userId,
      subscription: req.body?.subscription,
      userAgent:    req.headers["user-agent"] || null,
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

// POST /api/v1/push/unsubscribe
// Body: { endpoint: string }
async function unsubscribe(req, res, supabase) {
  try {
    await svc.deleteSubscription(supabase, {
      tenantId: req.tenantId,
      userId:   req.userId,
      endpoint: req.body?.endpoint,
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

// GET /api/v1/push/status?endpoint=…
// Ist dieses Gerät bereits registriert? (für die UI beim Laden)
async function status(req, res, supabase) {
  try {
    const subscribed = await svc.hasSubscription(supabase, {
      tenantId: req.tenantId,
      userId:   req.userId,
      endpoint: req.query?.endpoint,
    });
    return res.json({ subscribed });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

// POST /api/v1/push/test
// Schickt eine Test-Benachrichtigung an alle Geräte des angemeldeten Kontos.
async function test(req, res, supabase) {
  try {
    const { devices } = await svc.sendTestPush(supabase, {
      tenantId: req.tenantId,
      userId:   req.userId,
    });
    return res.json({ ok: true, devices });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

module.exports = { publicKey, subscribe, unsubscribe, status, test };
