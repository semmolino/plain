"use strict";

/**
 * Offene Registrierungen: freigeben oder ablehnen.
 *
 * HINTERGRUND (Sicherheitsaudit 2026-09-03, N3)
 *   POST /auth/signup im Backend legte Mandant, Firma und Erst-Nutzer in einem
 *   Zug an, mit sofort nutzbarem Passwort — ohne Nachweis, dass die Adresse dem
 *   Anmelder gehört, und ohne Zutun des Betreibers.
 *
 *   Seit Migration 0135 gibt es zwei Tore: der Anmelder bestätigt seine
 *   Adresse, dann gibt der Betreiber hier frei. Bis dahin ist die Anmeldung
 *   gesperrt (routes/auth.js), es entsteht also kein Datensatz in einem
 *   Mandanten, der danach abgelehnt wird.
 *
 * ABLEHNEN LÖSCHT
 *   Entscheidung des Betreibers vom 2026-09-04: eine Ablehnung entfernt
 *   Mandant, Firma und Erst-Nutzer unwiderruflich. Zwei Schranken dagegen,
 *   dass daraus versehentlich ein Datenverlust wird:
 *
 *     1. Gelöscht wird NUR im Zustand pending_email/pending_approval. Ein
 *        freigegebener Mandant mit echten Daten ist über diesen Weg nicht
 *        erreichbar — auch nicht, wenn jemand die ID von Hand einsetzt.
 *     2. Die Ablehnung landet im Änderungsprotokoll (Firma, Adresse, Grund,
 *        wer). Die Daten sind weg, die Entscheidung bleibt nachvollziehbar.
 */

const express = require("express");
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");
const { notify } = require("../services/notify");

const router = express.Router();

const OFFENE_ZUSTAENDE = ["pending_email", "pending_approval"];

function intParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Fehlt Migration 0135, soll die Konsole nicht mit einem Fehler stehenbleiben. */
function spalteFehlt(error) {
  return /column .* does not exist|SIGNUP_STATE/i.test(error?.message || "");
}

/**
 * GET /signups — offene Registrierungen mit Adresse des Anmelders.
 *
 * Der Erst-Nutzer ist der Mitarbeiter mit der kleinsten ID im Mandanten; eine
 * eigene Markierung dafür gibt es nicht, und beim Signup wird genau einer
 * angelegt.
 */
router.get("/signups", async (_req, res) => {
  const { data: tenants, error } = await supabase
    .from("TENANTS")
    .select("ID, TENANT, SIGNUP_STATE, EMAIL_CONFIRMED_AT, created_at")
    .in("SIGNUP_STATE", OFFENE_ZUSTAENDE)
    .order("created_at", { ascending: true });

  if (error) {
    if (spalteFehlt(error)) return res.json({ signups: [], migration_fehlt: true });
    return res.status(500).json({ error: error.message });
  }
  if (!tenants || tenants.length === 0) return res.json({ signups: [] });

  const ids = tenants.map((t) => t.ID);
  const { data: emps } = await supabase
    .from("EMPLOYEE")
    .select("ID, TENANT_ID, MAIL, SHORT_NAME")
    .in("TENANT_ID", ids)
    .order("ID", { ascending: true });

  const erster = new Map();
  for (const e of emps || []) if (!erster.has(e.TENANT_ID)) erster.set(e.TENANT_ID, e);

  res.json({
    signups: tenants.map((t) => ({
      TENANT_ID: t.ID,
      FIRMA: t.TENANT || null,
      STATE: t.SIGNUP_STATE,
      EMAIL: erster.get(t.ID)?.MAIL ?? null,
      KUERZEL: erster.get(t.ID)?.SHORT_NAME ?? null,
      ANGELEGT_AM: t.created_at,
      EMAIL_BESTAETIGT_AM: t.EMAIL_CONFIRMED_AT ?? null,
    })),
  });
});

/**
 * POST /signups/:id/approve — freigeben.
 *
 * Nur aus pending_approval: eine Freigabe vor der E-Mail-Bestätigung würde das
 * erste Tor überspringen, und genau dafür ist es da. Wer trotzdem freigeben
 * will, wartet die Bestätigung ab oder löscht und lädt neu ein.
 */
router.post("/signups/:id/approve", async (req, res) => {
  const id = intParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Ungültige Mandanten-ID." });

  const { data: tenant, error } = await supabase
    .from("TENANTS").select("ID, TENANT, SIGNUP_STATE").eq("ID", id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!tenant) return res.status(404).json({ error: "Mandant nicht gefunden." });

  if (tenant.SIGNUP_STATE === "active") {
    return res.status(409).json({ error: "Dieser Mandant ist bereits freigegeben." });
  }
  if (tenant.SIGNUP_STATE === "pending_email") {
    return res.status(409).json({
      error: "Die E-Mail-Adresse ist noch nicht bestätigt. Freigabe erst danach möglich.",
    });
  }

  const { data: geaendert, error: updErr } = await supabase
    .from("TENANTS")
    .update({
      SIGNUP_STATE: "active",
      APPROVED_AT: new Date().toISOString(),
      APPROVED_BY: req.adminEmail || null,
    })
    .eq("ID", id)
    .eq("SIGNUP_STATE", "pending_approval")   // kein Rennen mit einem zweiten Klick
    .select("ID");
  if (updErr) return res.status(500).json({ error: updErr.message });
  if (!geaendert || geaendert.length !== 1) {
    return res.status(409).json({ error: "Zustand hat sich zwischenzeitlich geändert. Bitte Liste neu laden." });
  }

  const { data: emp } = await supabase
    .from("EMPLOYEE").select("MAIL").eq("TENANT_ID", id).order("ID", { ascending: true }).limit(1).maybeSingle();

  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_SIGNUP", entityRef: id, action: "approve",
    after: { firma: tenant.TENANT, email: emp?.MAIL ?? null }, req,
  });

  // Der Anmelder muss erfahren, dass er jetzt hinein kann. notify() liefert
  // { sent, reason } und wirft nicht: ohne konfiguriertes SMTP gilt die
  // Freigabe trotzdem, und die Antwort sagt der Konsole, dass der Anmelder
  // nichts erfahren hat — dann kann der Betreiber selbst schreiben.
  const loginUrl = process.env.APP_URL || "https://planandsimple.de/login";
  const freigabeMail = emp?.MAIL
    ? await notify({
        to: emp.MAIL,
        subject: "plan&simple – Ihr Zugang ist freigegeben",
        text: `Ihr Konto für „${tenant.TENANT || "Ihr Büro"}" ist freigegeben.\n\nSie können sich jetzt anmelden:\n${loginUrl}`,
      })
    : { sent: false, reason: "no_recipient" };
  const mailVersandt = freigabeMail.sent;

  res.json({ ok: true, tenant_id: id, mail_versandt: mailVersandt, email: emp?.MAIL ?? null });
});

/**
 * POST /signups/:id/reject — ablehnen und löschen.
 *
 * Reihenfolge der Löschung folgt den Fremdschlüsseln: erst was auf EMPLOYEE
 * zeigt, dann EMPLOYEE, dann der Rest. Ein Mandant im Zustand pending hat
 * keine Projekte, Rechnungen oder Buchungen — nur das, was der Signup selbst
 * anlegt (siehe backend/routes/auth.js): TENANTS, COMPANY, EMPLOYEE,
 * USER_ROLE, ROLE_PERMISSION, EMPLOYEE_ROLE, TENANT_LICENSE.
 */
router.post("/signups/:id/reject", async (req, res) => {
  const id = intParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Ungültige Mandanten-ID." });
  const grund = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null;

  const { data: tenant, error } = await supabase
    .from("TENANTS").select("ID, TENANT, SIGNUP_STATE").eq("ID", id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!tenant) return res.status(404).json({ error: "Mandant nicht gefunden." });

  // SCHRANKE: niemals einen freigegebenen Mandanten löschen. Der hat echte
  // Daten, und dieser Weg ist für Anträge gedacht, nicht für Kündigungen.
  if (!OFFENE_ZUSTAENDE.includes(tenant.SIGNUP_STATE)) {
    return res.status(409).json({
      error: "Dieser Mandant ist freigegeben und kann hier nicht gelöscht werden. "
           + "Ein aktiver Mandant mit Daten wird nicht über die Antragsliste entfernt.",
    });
  }

  // Adresse VOR dem Löschen sichern — danach ist sie weg, und sowohl die
  // Ablehnungsmail als auch das Protokoll brauchen sie.
  const { data: emps } = await supabase
    .from("EMPLOYEE").select("ID, MAIL").eq("TENANT_ID", id).order("ID", { ascending: true });
  const empIds = (emps || []).map((e) => e.ID);
  const anmelderMail = emps?.[0]?.MAIL ?? null;

  const { data: rollen } = await supabase.from("USER_ROLE").select("ID").eq("TENANT_ID", id);
  const rollenIds = (rollen || []).map((r) => r.ID);

  const schritte = [];
  const loesche = async (tabelle, spalte, werte) => {
    if (Array.isArray(werte) && werte.length === 0) return;
    const q = supabase.from(tabelle).delete();
    const { error: e } = Array.isArray(werte) ? await q.in(spalte, werte) : await q.eq(spalte, werte);
    schritte.push({ tabelle, ok: !e, fehler: e?.message ?? null });
  };

  await loesche("EMPLOYEE_ROLE", "EMPLOYEE_ID", empIds);
  await loesche("ROLE_PERMISSION", "ROLE_ID", rollenIds);
  await loesche("USER_ROLE", "TENANT_ID", id);
  await loesche("TENANT_LICENSE", "TENANT_ID", id);
  await loesche("TENANT_SETTINGS", "TENANT_ID", id);
  await loesche("EMPLOYEE", "TENANT_ID", id);
  await loesche("COMPANY", "TENANT_ID", id);
  await loesche("TENANTS", "ID", id);

  const gescheitert = schritte.filter((s) => !s.ok);

  // Protokoll IMMER, auch bei Teilfehlern: die Entscheidung bleibt
  // nachvollziehbar, wenn die Daten weg sind. Das ist die zweite Schranke
  // gegen ein unwiderrufliches Löschen ohne Spur.
  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_SIGNUP", entityRef: id, action: "reject_delete",
    before: { firma: tenant.TENANT, email: anmelderMail, state: tenant.SIGNUP_STATE },
    context: { grund, schritte, mitarbeiter: empIds.length },
    req,
  });

  if (gescheitert.length) {
    return res.status(500).json({
      error: "Die Ablehnung ist nur teilweise durchgelaufen. Die Reste stehen im Änderungsprotokoll.",
      schritte,
    });
  }

  const ablehnungsMail = anmelderMail
    ? await notify({
        to: anmelderMail,
        subject: "plan&simple – Ihre Registrierung",
        text: `Ihre Registrierung für „${tenant.TENANT || "Ihr Büro"}" wurde nicht freigegeben.\n\n`
            + (grund ? `Begründung: ${grund}\n\n` : "")
            + `Bei Fragen antworten Sie einfach auf diese Nachricht.`,
      })
    : { sent: false, reason: "no_recipient" };
  const mailVersandt = ablehnungsMail.sent;

  res.json({ ok: true, deleted: true, tenant_id: id, mail_versandt: mailVersandt, email: anmelderMail });
});

module.exports = router;
