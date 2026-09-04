"use strict";

/**
 * Registrierung neuer Mandanten: E-Mail-Bestätigung und Freigabe.
 *
 * WARUM (Sicherheitsaudit 2026-09-03, N3)
 *   POST /auth/signup legte Mandant, Firma und Erst-Nutzer in einem Zug an,
 *   mit sofort nutzbarem Passwort. Niemand belegte, dass die Adresse dem
 *   Anmelder gehört, Mandanten mit fremden Firmennamen waren anlegbar, und
 *   jeder Eintrag zählte gegen Speicher und Datenbank.
 *
 * ZWEI TORE, IN DIESER REIHENFOLGE
 *   1. Der Anmelder bestätigt seine Adresse über einen Link (24 h).
 *   2. Der Plattformbetreiber gibt frei (Owner-Konsole).
 *
 *   Sequenziell und nicht parallel: über eine unbestätigte Adresse soll
 *   niemand entscheiden müssen. Und weil die Anmeldung bis zur Freigabe
 *   gesperrt ist, entsteht in einem später abgelehnten Mandanten kein
 *   einziger Datensatz.
 *
 * WARUM DER TOKEN WIE DIE ANDEREN AUSSIEHT
 *   Dasselbe Muster wie Passwort-Reset und Einladung: ein JWT mit `purpose`,
 *   signiert mit JWT_SECRET. middleware/auth.js lehnt Token mit `purpose`
 *   als Sitzung ab (M2) — ein Bestätigungslink ist damit keine Anmeldung,
 *   auch nicht versehentlich.
 *
 *   Zusätzlich trägt er den Mandantenzustand als Fingerabdruck: ist die
 *   Adresse schon bestätigt, passt er nicht mehr. Der Link ist damit
 *   einmalig, ohne dass es eine Tabelle für verbrauchte Token braucht —
 *   dieselbe Überlegung wie beim Reset-Fingerprint in routes/auth.js.
 */

const jwt = require("jsonwebtoken");
const { sendMail } = require("./emailService");

const GUELTIGKEIT_STD = 24;

const ZUSTAND = {
  MAIL_OFFEN:     "pending_email",
  FREIGABE_OFFEN: "pending_approval",
  AKTIV:          "active",
};

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is required");
  return s;
}

function frontendUrl(req) {
  return process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
}

/** Token für den Bestätigungslink. Nur gültig, solange die Adresse offen ist. */
function baueToken(tenantId, email) {
  return jwt.sign(
    { tenant_id: Number(tenantId), email, purpose: "signup_confirm", st: ZUSTAND.MAIL_OFFEN },
    jwtSecret(),
    { expiresIn: `${GUELTIGKEIT_STD}h` }
  );
}

/**
 * Schickt den Bestätigungslink an den Anmelder.
 *
 * Wirft {status:503} weiter, wenn kein Versand konfiguriert ist — anders als
 * bei einer Erinnerung ist das hier kein Randfall, den man verschlucken darf:
 * ohne Mail kommt der Anmelder nie in sein Konto.
 */
async function sendeBestaetigungsmail({ req, tenantId, email, firma }) {
  const url = `${frontendUrl(req)}/registrierung-bestaetigen?token=${baueToken(tenantId, email)}`;
  await sendMail({
    to: email,
    subject: "plan&simple – E-Mail-Adresse bestätigen",
    text:
      `Willkommen bei plan&simple.\n\n` +
      `Bitte bestätigen Sie Ihre E-Mail-Adresse für „${firma}" über diesen Link ` +
      `(gültig ${GUELTIGKEIT_STD} Stunden):\n\n${url}\n\n` +
      `Danach prüfen wir Ihr Konto und geben es frei. Sie erhalten eine weitere ` +
      `Nachricht, sobald die Anmeldung möglich ist.`,
    html:
      `<p>Willkommen bei plan&amp;simple.</p>` +
      `<p>Bitte bestätigen Sie Ihre E-Mail-Adresse für „${firma}" über diesen Link ` +
      `(gültig ${GUELTIGKEIT_STD} Stunden):</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>Danach prüfen wir Ihr Konto und geben es frei. Sie erhalten eine weitere ` +
      `Nachricht, sobald die Anmeldung möglich ist.</p>`,
  });
  return url;
}

/**
 * Prüft den Bestätigungslink und schaltet den Mandanten auf "wartet auf
 * Freigabe".
 *
 * @returns {{tenantId:number, firma:string|null, email:string}}
 * @throws  {{status:number, message:string}}
 */
async function bestaetigeEmail(supabase, token) {
  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret());
  } catch {
    throw { status: 400, message: "Der Link ist ungültig oder abgelaufen. Bitte registrieren Sie sich erneut." };
  }
  if (decoded.purpose !== "signup_confirm" || !decoded.tenant_id) {
    throw { status: 400, message: "Ungültiger Link." };
  }

  const { data: tenant, error } = await supabase
    .from("TENANTS")
    .select("ID, TENANT, SIGNUP_STATE")
    .eq("ID", decoded.tenant_id)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!tenant) {
    // Kann vorkommen: der Antrag wurde in der Konsole abgelehnt und dabei
    // gelöscht, bevor der Anmelder den Link geöffnet hat.
    throw { status: 400, message: "Dieser Zugang existiert nicht mehr. Bitte registrieren Sie sich erneut." };
  }

  if (tenant.SIGNUP_STATE === ZUSTAND.AKTIV) {
    return { tenantId: tenant.ID, firma: tenant.TENANT, email: decoded.email, schonAktiv: true };
  }
  if (tenant.SIGNUP_STATE === ZUSTAND.FREIGABE_OFFEN) {
    // Link ein zweites Mal geöffnet — kein Fehler, aber auch nichts zu tun.
    return { tenantId: tenant.ID, firma: tenant.TENANT, email: decoded.email, schonBestaetigt: true };
  }

  const { data: geaendert, error: updErr } = await supabase
    .from("TENANTS")
    .update({ SIGNUP_STATE: ZUSTAND.FREIGABE_OFFEN, EMAIL_CONFIRMED_AT: new Date().toISOString() })
    .eq("ID", tenant.ID)
    .eq("SIGNUP_STATE", ZUSTAND.MAIL_OFFEN)   // idempotent: nur aus dem erwarteten Zustand
    .select("ID");
  if (updErr) throw { status: 500, message: updErr.message };
  if (!geaendert || geaendert.length !== 1) {
    throw { status: 500, message: "Die Bestätigung konnte nicht gespeichert werden. Bitte Administrator kontaktieren." };
  }

  return { tenantId: tenant.ID, firma: tenant.TENANT, email: decoded.email };
}

/**
 * Benachrichtigt die Plattform-Admins über einen neuen Antrag.
 *
 * Empfänger sind die aktiven PLATFORM_ADMIN-Adressen — keine eigene
 * Umgebungsvariable, die man beim Wechsel eines Betreibers vergessen könnte.
 * Best-effort: der Anmelder hat seinen Teil erledigt, an einer nicht
 * zugestellten Hinweismail darf das nicht scheitern. Der Antrag ist in der
 * Konsole ohnehin sichtbar.
 */
async function benachrichtigeBetreiber(supabase, { tenantId, firma, email }) {
  try {
    const { data: admins } = await supabase
      .from("PLATFORM_ADMIN")
      .select("EMAIL, IS_ACTIVE");
    const empfaenger = (admins || []).filter((a) => a.IS_ACTIVE && a.EMAIL).map((a) => a.EMAIL);
    if (empfaenger.length === 0) {
      console.warn("[SIGNUP] Kein aktiver Plattform-Admin mit Adresse — keine Hinweismail versendet.");
      return false;
    }
    await sendMail({
      to: empfaenger.join(", "),
      subject: `plan&simple – neue Registrierung wartet auf Freigabe: ${firma || "(ohne Namen)"}`,
      text:
        `Ein neuer Mandant hat seine E-Mail-Adresse bestätigt und wartet auf Freigabe.\n\n` +
        `Firma:   ${firma || "(ohne Namen)"}\n` +
        `Adresse: ${email}\n` +
        `Mandant: ${tenantId}\n\n` +
        `Freigeben oder ablehnen in der Owner-Konsole unter „Mandanten".`,
    });
    return true;
  } catch (e) {
    console.warn("[SIGNUP] Hinweismail an Betreiber fehlgeschlagen:", e?.message || e);
    return false;
  }
}

/** Teilt dem Anmelder die Freigabe mit. Best-effort. */
async function sendeFreigabemail({ email, firma, loginUrl }) {
  try {
    await sendMail({
      to: email,
      subject: "plan&simple – Ihr Zugang ist freigegeben",
      text:
        `Ihr Konto für „${firma || "Ihr Büro"}" ist freigegeben.\n\n` +
        `Sie können sich jetzt anmelden:\n${loginUrl}`,
      html:
        `<p>Ihr Konto für „${firma || "Ihr Büro"}" ist freigegeben.</p>` +
        `<p>Sie können sich jetzt anmelden: <a href="${loginUrl}">${loginUrl}</a></p>`,
    });
    return true;
  } catch (e) {
    console.warn("[SIGNUP] Freigabemail fehlgeschlagen:", e?.message || e);
    return false;
  }
}

/** Teilt dem Anmelder die Ablehnung mit. Best-effort. */
async function sendeAblehnungsmail({ email, firma, grund }) {
  try {
    await sendMail({
      to: email,
      subject: "plan&simple – Ihre Registrierung",
      text:
        `Ihre Registrierung für „${firma || "Ihr Büro"}" wurde nicht freigegeben.\n\n` +
        (grund ? `Begründung: ${grund}\n\n` : "") +
        `Bei Fragen antworten Sie einfach auf diese Nachricht.`,
    });
    return true;
  } catch (e) {
    console.warn("[SIGNUP] Ablehnungsmail fehlgeschlagen:", e?.message || e);
    return false;
  }
}

/**
 * Meldung für einen Anmeldeversuch, dessen Mandant noch nicht freigegeben ist.
 * null heisst: Anmeldung erlaubt.
 */
function loginSperre(signupState) {
  // Ein leerer Wert bedeutet "Migration 0135 noch nicht eingespielt" und darf
  // niemanden aussperren.
  if (!signupState || signupState === ZUSTAND.AKTIV) return null;
  if (signupState === ZUSTAND.MAIL_OFFEN) {
    return "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse. Den Link haben wir Ihnen bei der Registrierung geschickt.";
  }
  if (signupState === ZUSTAND.FREIGABE_OFFEN) {
    return "Ihre E-Mail-Adresse ist bestätigt. Wir prüfen Ihr Konto und geben es zeitnah frei — Sie erhalten dann eine Nachricht.";
  }
  return "Dieser Zugang ist derzeit nicht freigegeben. Bitte wenden Sie sich an den Support.";
}

module.exports = {
  ZUSTAND,
  GUELTIGKEIT_STD,
  baueToken,
  sendeBestaetigungsmail,
  bestaetigeEmail,
  benachrichtigeBetreiber,
  sendeFreigabemail,
  sendeAblehnungsmail,
  loginSperre,
};
