"use strict";

// ---------------------------------------------------------------------------
// Web-Push (VAPID) — zusätzlicher Zustellkanal für NOTIFICATIONs.
//
// Design:
//   * Die "wer bekommt was"-Logik lebt weiterhin in notifications.js /
//     notificationConfig.js. Dieser Service wird von insertOne() aufgerufen,
//     NACHDEM eine NOTIFICATION-Zeile geschrieben wurde, und stellt sie
//     zusätzlich als Betriebssystem-Push an alle Geräte zu, die der jeweilige
//     Empfänger freigegeben hat.
//   * Ohne konfigurierte VAPID-Keys ist alles ein No-Op (kein Crash, keine
//     Requires) — so bleiben Tests und lokale Setups ohne Keys lauffähig.
//   * web-push wird lazy geladen, damit die Abhängigkeit nur dort gebraucht
//     wird, wo tatsächlich versendet wird.
// ---------------------------------------------------------------------------

let _webpush = null;
let _configured = null; // null = noch nicht geprüft

function getConfig() {
  return {
    publicKey:  process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject:    process.env.VAPID_SUBJECT || "mailto:support@plan-simple.app",
  };
}

// Ist Web-Push einsatzbereit? (Keys vorhanden + Lib ladbar)
function isConfigured() {
  if (_configured !== null) return _configured;
  const { publicKey, privateKey } = getConfig();
  if (!publicKey || !privateKey) {
    _configured = false;
    return false;
  }
  try {
    _webpush = require("web-push");
    _webpush.setVapidDetails(getConfig().subject, publicKey, privateKey);
    _configured = true;
  } catch (e) {
    console.warn("[PUSH] web-push nicht verfügbar, Push deaktiviert:", e?.message || e);
    _configured = false;
  }
  return _configured;
}

// Öffentlicher VAPID-Schlüssel für das Frontend (applicationServerKey).
function getPublicKey() {
  return getConfig().publicKey || null;
}

// ---------------------------------------------------------------------------
// Subscription speichern (Upsert auf ENDPOINT — Re-Subscribe überschreibt).
// ---------------------------------------------------------------------------
async function saveSubscription(supabase, { tenantId, userId, subscription, userAgent = null }) {
  if (!tenantId || !userId) throw { status: 400, message: "tenantId und userId erforderlich" };
  const endpoint = subscription?.endpoint;
  const p256dh   = subscription?.keys?.p256dh;
  const auth     = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw { status: 400, message: "Ungültige Push-Subscription (endpoint/keys fehlen)" };
  }

  const row = {
    TENANT_ID:  tenantId,
    USER_ID:    String(userId),
    ENDPOINT:   endpoint,
    P256DH:     p256dh,
    AUTH:       auth,
    USER_AGENT: userAgent ? String(userAgent).slice(0, 400) : null,
  };

  const { error } = await supabase
    .from("PUSH_SUBSCRIPTION")
    .upsert([row], { onConflict: "ENDPOINT" });

  if (error) throw { status: 500, message: error.message };
}

// ---------------------------------------------------------------------------
// Subscription entfernen (Opt-out auf diesem Gerät).
// ---------------------------------------------------------------------------
async function deleteSubscription(supabase, { tenantId, userId, endpoint }) {
  if (!endpoint) throw { status: 400, message: "endpoint erforderlich" };
  const { error } = await supabase
    .from("PUSH_SUBSCRIPTION")
    .delete()
    .eq("TENANT_ID", tenantId)
    .eq("USER_ID", String(userId))
    .eq("ENDPOINT", endpoint);
  if (error) throw { status: 500, message: error.message };
}

// Ist dieses Gerät (Endpoint) bereits registriert?
async function hasSubscription(supabase, { tenantId, userId, endpoint }) {
  if (!endpoint) return false;
  const { data } = await supabase
    .from("PUSH_SUBSCRIPTION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("USER_ID", String(userId))
    .eq("ENDPOINT", endpoint)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// Einen einzelnen Push senden. Räumt tote Endpoints (404/410) automatisch weg.
// ---------------------------------------------------------------------------
async function sendOne(supabase, sub, payloadStr) {
  try {
    await _webpush.sendNotification(
      { endpoint: sub.ENDPOINT, keys: { p256dh: sub.P256DH, auth: sub.AUTH } },
      payloadStr,
    );
    // best-effort: letzten erfolgreichen Versand vermerken
    await supabase
      .from("PUSH_SUBSCRIPTION")
      .update({ LAST_USED_AT: new Date().toISOString() })
      .eq("ID", sub.ID);
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) {
      // Endpoint existiert nicht mehr (App deinstalliert / Abo abgelaufen)
      await supabase.from("PUSH_SUBSCRIPTION").delete().eq("ID", sub.ID);
    } else {
      console.warn(`[PUSH] Versand fehlgeschlagen (${code || "?"}): ${err?.message || err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// sendPushForNotification — Hook aus notifications.insertOne().
//
// userId gesetzt  -> nur Geräte dieses Empfängers.
// userId null     -> tenant-weit (Broadcast) -> alle Geräte des Mandanten.
//
// Bewusst fire-and-forget beim Aufrufer: Der Notification-Insert soll nie auf
// den Push-Versand warten oder daran scheitern.
// ---------------------------------------------------------------------------
async function sendPushForNotification(supabase, { tenantId, userId = null, title, body = null, link = null }) {
  if (!isConfigured()) return;
  if (!tenantId || !title) return;

  let q = supabase
    .from("PUSH_SUBSCRIPTION")
    .select("ID, ENDPOINT, P256DH, AUTH")
    .eq("TENANT_ID", tenantId);

  // Tenant-weite Notification (USER_ID null) -> an alle Geräte des Mandanten.
  // User-spezifisch -> nur an dessen Geräte.
  if (userId !== null && userId !== undefined) {
    q = q.eq("USER_ID", String(userId));
  }

  const { data: subs, error } = await q;
  if (error) {
    console.warn("[PUSH] Subscriptions laden fehlgeschlagen:", error.message);
    return;
  }
  if (!Array.isArray(subs) || subs.length === 0) return;

  const payloadStr = JSON.stringify({
    title,
    body: body || "",
    link: link || "/",
  });

  await Promise.allSettled(subs.map(sub => sendOne(supabase, sub, payloadStr)));
}

// ---------------------------------------------------------------------------
// sendTestPush — Diagnose-Knopf im Profil.
//
// Geht denselben Weg wie eine echte Benachrichtigung (dieselbe Abfrage,
// dieselbe Zustellung), schreibt aber KEINE NOTIFICATION-Zeile. Damit laesst
// sich trennen, was bei einer ausbleibenden Erinnerung kaputt ist: der
// Zustellkanal (Test kommt nicht an) oder die Zeitsteuerung (Test kommt an,
// die geplante Erinnerung nicht).
//
// Anders als sendPushForNotification wird hier bewusst GEWARTET und ein
// Ergebnis zurueckgemeldet — der Nutzer soll sehen, woran es liegt.
// ---------------------------------------------------------------------------
async function sendTestPush(supabase, { tenantId, userId }) {
  if (!isConfigured()) {
    throw { status: 400, message: "Push ist auf dem Server nicht konfiguriert (VAPID-Schlüssel fehlen)." };
  }

  const { data: subs, error } = await supabase
    .from("PUSH_SUBSCRIPTION")
    .select("ID, ENDPOINT, P256DH, AUTH")
    .eq("TENANT_ID", tenantId)
    .eq("USER_ID", String(userId));

  if (error) throw { status: 500, message: error.message };
  if (!Array.isArray(subs) || subs.length === 0) {
    throw { status: 400, message: "Für dieses Konto ist kein Gerät registriert. Zuerst „Auf diesem Gerät aktivieren“." };
  }

  const payloadStr = JSON.stringify({
    title: "Test-Benachrichtigung",
    body:  "Wenn du das siehst, funktioniert der Push-Versand auf diesem Gerät.",
    link:  "/profil",
    tag:   "plain-push-test",
  });

  await Promise.allSettled(subs.map(sub => sendOne(supabase, sub, payloadStr)));

  // sendOne raeumt tote Endpoints selbst weg. Was danach noch steht, hat den
  // Push angenommen — die Zahl ist damit die ehrlichste Rueckmeldung, die
  // sich ohne Zustellbestaetigung des Push-Dienstes geben laesst.
  const { data: rest } = await supabase
    .from("PUSH_SUBSCRIPTION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("USER_ID", String(userId));

  return { devices: Array.isArray(rest) ? rest.length : subs.length };
}

module.exports = {
  isConfigured,
  getPublicKey,
  saveSubscription,
  deleteSubscription,
  hasSubscription,
  sendPushForNotification,
  sendTestPush,
};
