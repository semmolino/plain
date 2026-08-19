"use strict";

// ============================================================================
// accountInvite.js — Erstzugang fuer neu angelegte Mitarbeiter
//
// WARUM ES DAS GIBT
//   Frueher vergab der Admin im Anlage-Wizard ein Passwort fuer den neuen
//   Mitarbeiter. Das ist aus zwei Gruenden falsch: der Admin kennt danach das
//   Passwort seines Kollegen, und der Kollege hat nie eines gewaehlt. Statt
//   dessen legt der Admin nur noch das Konto an — das Passwort setzt der
//   Mitarbeiter selbst ueber einen einmaligen Link, den er per Mail bekommt.
//
//   Serverseitig ist eine Anmeldung ohne gesetztes Passwort ohnehin gesperrt
//   (routes/auth.js, POST /login). Ein Konto ohne Einladung ist also kein
//   offenes Konto, sondern schlicht ein noch nicht nutzbares.
//
// WARUM DERSELBE TOKEN WIE BEIM PASSWORT-VERGESSEN
//   Der Reset-Token traegt purpose:"reset" und einen Fingerprint des aktuellen
//   Passwort-Hashes (pv). POST /auth/reset-confirm prueft beides. Bei einem
//   frischen Konto ist PASSWORD null, der Fingerprint also der des leeren
//   Werts — und sobald der Mitarbeiter sein Passwort setzt, passt er nicht
//   mehr: der Einladungslink ist damit automatisch einmalig, und eine zweite
//   Einladung entwertet die erste. Ein eigener Token-Typ haette dieselbe
//   Pruefung noch einmal gebraucht.
//
// GUELTIGKEIT
//   Laenger als beim Zuruecksetzen (1 h): eine Einladung landet oft im
//   Postfach eines Kollegen, der gerade im Urlaub oder auf der Baustelle ist.
//   7 Tage sind lang genug fuer den Alltag und kurz genug, dass ein vergessener
//   Link nicht ueber Monate offen steht.
// ============================================================================

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendMail } = require("./emailService");

const GUELTIGKEIT = "7d";
const GUELTIGKEIT_TEXT = "7 Tage";

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is required");
  return s;
}

/**
 * One-Time-Fingerprint des aktuellen Passwort-Hashes — identisch zu der
 * Funktion in routes/auth.js, damit reset-confirm den Token akzeptiert.
 */
function pwdFingerprint(passwordHashOrNull) {
  return crypto.createHash("sha256").update(String(passwordHashOrNull || "")).digest("hex").slice(0, 16);
}

function baseUrl(req) {
  return process.env.FRONTEND_URL || (req ? `${req.protocol}://${req.get("host")}` : "");
}

/**
 * Baut den Einladungslink. `welcome=1` schaltet auf der Zielseite die
 * Begruessungs-Variante frei ("Zugang einrichten" statt "Passwort
 * zuruecksetzen") — derselbe Bildschirm, anderer Anlass.
 */
function buildInviteUrl(req, { employeeId, mail, passwordHash }) {
  const token = jwt.sign(
    { employee_id: employeeId, email: mail, purpose: "reset", pv: pwdFingerprint(passwordHash) },
    jwtSecret(),
    { expiresIn: GUELTIGKEIT }
  );
  return `${baseUrl(req)}/reset-password?token=${token}&welcome=1`;
}

function mailBody({ vorname, firma, url }) {
  const anrede = vorname ? `Hallo ${vorname},` : "Hallo,";
  const wer = firma ? `${firma} hat` : "Ihr Unternehmen hat";
  const text =
    `${anrede}\n\n` +
    `${wer} für Sie einen Zugang zu plan&simple angelegt.\n\n` +
    `Bitte legen Sie über den folgenden Link Ihr eigenes Passwort fest. ` +
    `Der Link ist ${GUELTIGKEIT_TEXT} gültig und kann nur einmal verwendet werden:\n\n` +
    `${url}\n\n` +
    `Danach können Sie sich mit Ihrer E-Mail-Adresse und dem selbst gewählten Passwort anmelden.\n\n` +
    `Wenn Sie mit dieser Einladung nichts anfangen können, ignorieren Sie diese Nachricht einfach.`;
  const html =
    `<p>${anrede}</p>` +
    `<p>${wer} für Sie einen Zugang zu plan&amp;simple angelegt.</p>` +
    `<p>Bitte legen Sie über den folgenden Link Ihr eigenes Passwort fest. ` +
    `Der Link ist ${GUELTIGKEIT_TEXT} gültig und kann nur einmal verwendet werden:</p>` +
    `<p><a href="${url}">Passwort jetzt festlegen</a></p>` +
    `<p style="font-size:12px;color:#666">Falls der Knopf nicht funktioniert: ${url}</p>` +
    `<p>Danach können Sie sich mit Ihrer E-Mail-Adresse und dem selbst gewählten Passwort anmelden.</p>` +
    `<p style="font-size:12px;color:#666">Wenn Sie mit dieser Einladung nichts anfangen können, ` +
    `ignorieren Sie diese Nachricht einfach.</p>`;
  return { text, html };
}

/**
 * Verschickt die Einladung.
 *
 * Wirft NICHT bei Mailproblemen, sondern liefert ein Ergebnisobjekt — das
 * Anlegen eines Mitarbeiters darf nicht daran scheitern, dass der Mailversand
 * gerade klemmt. Der Aufrufer reicht `sent`/`reason` an die Oberflaeche
 * durch, damit dort "Einladung erneut senden" angeboten werden kann.
 *
 * @returns {Promise<{sent: boolean, reason?: string, url?: string}>}
 */
async function sendInvite(req, { employeeId, mail, firstName, passwordHash = null, companyName = null }) {
  if (!mail) return { sent: false, reason: "Keine E-Mail-Adresse hinterlegt." };

  const url = buildInviteUrl(req, { employeeId, mail, passwordHash });
  const { text, html } = mailBody({ vorname: firstName, firma: companyName, url });

  try {
    // System-Mail -> Plattform-Absender, bewusst OHNE tenantId (wie beim
    // Passwort-Zuruecksetzen). Der Empfaenger hat noch keinen Zugang, die
    // Nachricht kommt also von plan&simple, nicht vom Mandanten.
    await sendMail({
      to: mail,
      subject: "Ihr Zugang zu plan&simple – Passwort festlegen",
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    if (err?.status === 503) {
      // Kein Versand konfiguriert: Link ins Log, damit ein Administrator ihn
      // notfalls von Hand weitergeben kann.
      console.log(`[EINLADUNG] ${mail}: ${url}`);
      return { sent: false, reason: "E-Mail-Versand ist nicht konfiguriert.", url };
    }
    console.error("[EINLADUNG] Mailfehler:", err?.message || err);
    return { sent: false, reason: err?.message || "E-Mail konnte nicht gesendet werden." };
  }
}

module.exports = { sendInvite, buildInviteUrl, pwdFingerprint, GUELTIGKEIT_TEXT };
