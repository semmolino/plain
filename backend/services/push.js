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
let _stummGemeldet = false;   // Warnung bei fehlender Konfiguration nur einmal

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

// Der sub-Claim des VAPID-Tokens. Für die Selbstauskunft: Apple lehnt Tokens
// mit unbrauchbarem Subject ab, und der eingebaute Standardwert zeigt auf eine
// Domain, die nicht zwingend uns gehört — das soll man sehen können, ohne die
// Umgebungsvariablen des Servers aufzurufen.
function getSubject() {
  return {
    wert:      getConfig().subject,
    ausStandard: !process.env.VAPID_SUBJECT,
  };
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

// Welcher Push-Dienst steht hinter diesem Endpoint? Der Host ist die einzige
// Angabe aus dem Endpoint, die man protokollieren darf: der Pfad dahinter IST
// das Zustellgeheimnis. Für die Fehlersuche ist er aber entscheidend — Apple,
// Google und Mozilla lehnen aus unterschiedlichen Gründen ab.
function dienstVon(endpoint) {
  try {
    return new URL(String(endpoint)).host;
  } catch {
    return "unbekannt";
  }
}

// ---------------------------------------------------------------------------
// Einen einzelnen Push senden. Räumt tote Endpoints (404/410) automatisch weg.
//
// GIBT DAS ERGEBNIS ZURÜCK, statt es zu schlucken. Vorher endete jeder Fehler
// ausser 404/410 in einer console.warn — mit der Folge, dass der Test-Knopf im
// Profil „verschickt" meldete, obwohl der Push-Dienst die Zustellung abgelehnt
// hatte. Das einzige Werkzeug, das die Wahrheit sagen sollte, beschönigte
// damit genau den Fall, für den es gebaut wurde.
// ---------------------------------------------------------------------------
async function sendOne(supabase, sub, payloadStr) {
  const dienst = dienstVon(sub.ENDPOINT);
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
    return { ok: true, dienst };
  } catch (err) {
    const code = err?.statusCode || null;
    if (code === 404 || code === 410) {
      // Endpoint existiert nicht mehr (Abo abgelaufen, Browserdaten geloescht).
      // Kein Fehler im eigentlichen Sinn: das Geraet ist weg, die Zeile auch.
      await supabase.from("PUSH_SUBSCRIPTION").delete().eq("ID", sub.ID);
      return { ok: false, dienst, code, entfernt: true, meldung: "Registrierung abgelaufen" };
    }
    const meldung = kurzeMeldung(err);
    console.warn(`[PUSH] Versand abgelehnt von ${dienst} (${code || "?"}): ${meldung}`);
    return { ok: false, dienst, code, entfernt: false, meldung };
  }
}

// Die Antwort der Push-Dienste ist oft ein mehrzeiliger Body samt Headern. Für
// die Oberfläche zählt die erste Zeile — dort steht der Grund.
function kurzeMeldung(err) {
  const roh = err?.body || err?.message || String(err);
  return String(roh).split("\n")[0].trim().slice(0, 200);
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
  if (!isConfigured()) {
    // Frueher stand hier ein wortloses return. Damit war ein nicht
    // konfigurierter Server von einem funktionierenden nicht zu unterscheiden:
    // die NOTIFICATION-Zeile entstand, in der App war alles zu sehen, auf dem
    // Geraet kam nichts an — und im Protokoll stand kein Wort. Genau diese
    // Klasse stiller Ausfaelle hat die Fehlersuche gekostet.
    if (!_stummGemeldet) {
      _stummGemeldet = true;
      console.warn(
        "[PUSH] Benachrichtigung wollte auf ein Geraet — aber VAPID ist nicht " +
        "konfiguriert. Alle Geraete-Pushes entfallen (still), bis " +
        "VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY gesetzt sind."
      );
    }
    return;
  }
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

  // Auch dieser Rueckfall war wortlos — und er ist der wahrscheinlichste, wenn
  // der Test-Knopf ankommt, die geplante Erinnerung aber nicht: der Test sucht
  // im Request nach dem angemeldeten Konto, der Checker sucht im Systemkontext
  // nach der USER_ID, die in der Benachrichtigung steht. Passen die beiden
  // nicht zusammen, findet die zweite Abfrage nichts.
  //
  // Die Gegenprobe im selben Atemzug beantwortet genau diese Frage: sind im
  // Mandanten ueberhaupt Geraete registriert? Steht dort eine Zahl > 0 und
  // hier 0, liegt es an der USER_ID und nicht am Kanal. Die zusaetzliche
  // Abfrage kostet nur im Fehlerfall etwas.
  if (!Array.isArray(subs) || subs.length === 0) {
    let imMandanten = "?";
    try {
      const { data: alle } = await supabase
        .from("PUSH_SUBSCRIPTION")
        .select("USER_ID")
        .eq("TENANT_ID", tenantId);
      imMandanten = Array.isArray(alle) ? String(alle.length) : "?";
    } catch { /* Gegenprobe ist Beiwerk, nie der Grund fuer einen Abbruch */ }

    console.warn(
      `[PUSH] "${title}": kein registriertes Geraet gefunden. Gesucht wurde ` +
      (userId === null || userId === undefined
        ? `mandantenweit (Mandant ${tenantId})`
        : `USER_ID=${String(userId)} in Mandant ${tenantId}`) +
      ` — im Mandanten registriert: ${imMandanten}.`
    );
    return;
  }

  const payloadStr = JSON.stringify({
    title,
    body: body || "",
    link: link || "/",
  });

  const ergebnisse = await Promise.all(subs.map(sub => sendOne(supabase, sub, payloadStr)));

  // Eine Zeile je Benachrichtigung, aber nur wenn etwas schiefging. Ohne sie
  // steht im Protokoll zwar jede einzelne Ablehnung (aus sendOne), aber nicht,
  // ob damit ALLE Geraete eines Empfaengers leer ausgingen — und genau das ist
  // der Unterschied zwischen „ein altes Handy zickt" und „es kommt nichts an".
  const gescheitert = ergebnisse.filter(r => !r.ok && !r.entfernt);
  const zugestellt  = ergebnisse.filter(r => r.ok).length;

  // Auch der Erfolg wird protokolliert — eine Zeile je Benachrichtigung.
  //
  // Ohne sie bleibt die eine Frage offen, an der die Fehlersuche haengt: ging
  // der Push hinaus und kam nicht an, oder ging er nie hinaus? Beides sah im
  // Protokoll gleich aus, naemlich nach gar nichts. Das ist keine Schwatzhaftigkeit:
  // es gibt wenige Benachrichtigungen am Tag, und diese Zeile ist die einzige
  // Spur eines Vorgangs, der sonst ausserhalb jeder Sichtweite stattfindet.
  if (zugestellt > 0) {
    console.log(
      `[PUSH] "${title}": an ${zugestellt} von ${ergebnisse.length} Geraeten ` +
      `uebergeben (${ergebnisse.filter(r => r.ok).map(r => r.dienst).join(", ")}).`
    );
  }

  if (gescheitert.length > 0) {
    console.warn(
      `[PUSH] "${title}": ${zugestellt} von ${ergebnisse.length} ` +
      `Geraeten zugestellt. Abgelehnt: ` +
      gescheitert.map(r => `${r.dienst} ${r.code || "?"}`).join(", ")
    );
  }
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

  const ergebnisse = await Promise.all(subs.map(sub => sendOne(supabase, sub, payloadStr)));

  // Frueher stand hier eine Zaehlung der uebrig gebliebenen Zeilen. Die war
  // irrefuehrend: sendOne entfernt nur bei 404/410: eine Ablehnung mit 400 oder
  // 403 liess die Zeile stehen, und der Test meldete „an 1 Geraet verschickt",
  // obwohl nichts ankam. Genau dieser Fall — Schluessel gesetzt, Geraet
  // registriert, trotzdem keine Zustellung — ist der, den man sucht.
  //
  // Gemeldet wird deshalb, was die Push-Dienste geantwortet haben. Mehr ist
  // ehrlicherweise nicht zu holen: ob die Meldung auf dem Bildschirm erscheint,
  // bestaetigt kein Dienst zurueck.
  const zugestellt   = ergebnisse.filter(r => r.ok).length;
  const abgelaufen   = ergebnisse.filter(r => r.entfernt).length;
  const fehlerListe  = ergebnisse
    .filter(r => !r.ok && !r.entfernt)
    .map(r => ({ dienst: r.dienst, code: r.code, meldung: r.meldung }));

  return {
    devices: subs.length,
    zugestellt,
    abgelaufen,
    fehler: fehlerListe,
    // Das Subject steht im signierten Token und ist der Grund, aus dem Apple
    // am haeufigsten ablehnt. Es hier mitzugeben kostet nichts und spart die
    // Rueckfrage „was steht denn in VAPID_SUBJECT?".
    subject: getConfig().subject,
  };
}

module.exports = {
  isConfigured,
  getPublicKey,
  getSubject,
  saveSubscription,
  deleteSubscription,
  hasSubscription,
  sendPushForNotification,
  sendTestPush,
};
