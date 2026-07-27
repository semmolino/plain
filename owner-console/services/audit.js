"use strict";

const { supabase } = require("./db");

/**
 * Schreibt einen Eintrag ins LICENSE_CHANGE_LOG. Jede mutierende Aktion der
 * Konsole MUSS hierdurch protokolliert werden (Nachvollziehbarkeit + Rollback).
 * Best-effort: ein fehlgeschlagenes Log darf die eigentliche Aktion nicht
 * zurückrollen, wird aber laut geloggt.
 *
 * `context` (Migration 0102) nimmt sprechende Zusatzangaben auf — Mandanten-
 * und Planname —, damit die Anzeige nicht nur technische IDs zeigt.
 * `req` ist optional und liefert IP + User-Agent für sicherheitsrelevante
 * Control-Plane-Zugriffe.
 */
async function writeChangeLog({ actor, entity, entityRef, action, before, after, context, req }) {
  try {
    const row = {
      ACTOR: actor || "unknown",
      ENTITY: entity,
      ENTITY_REF: entityRef != null ? String(entityRef) : null,
      ACTION: action,
      BEFORE: before ?? null,
      AFTER: after ?? null,
    };
    if (context) row.CONTEXT = context;
    if (req) {
      row.IP = req.ip || req.headers?.["x-forwarded-for"] || null;
      row.USER_AGENT = (req.headers?.["user-agent"] || "").slice(0, 500) || null;
    }
    const { error } = await supabase.from("LICENSE_CHANGE_LOG").insert([row]);
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (e) {
    console.error("[audit] insert threw:", e?.message || e);
  }
}

// ── Sprechende Bezeichnungen ────────────────────────────────────────────────
// Das Audit-Log speichert technische Werte (stabil, maschinenlesbar). Für die
// Anzeige werden sie hier nach Deutsch übersetzt — die Konsole soll ohne
// Schema-Kenntnis lesbar sein.

/** ENTITY -> { label, describe(entry) -> sprechende Objektbezeichnung } */
const ENTITY_LABELS = {
  LICENSE_PLAN: {
    label: "Lizenzplan",
    describe: (e) => e.CONTEXT?.plan_name || e.AFTER?.NAME_DE || e.BEFORE?.NAME_DE || `Plan #${e.ENTITY_REF}`,
  },
  PLAN_CAPABILITY: {
    label: "Plan-Inhalt",
    describe: (e) => {
      const [planId, capKey] = String(e.ENTITY_REF || "").split(":");
      const plan = e.CONTEXT?.plan_name || `Plan #${planId}`;
      const cap = e.CONTEXT?.capability_label || capKey || "";
      return `${plan} · ${cap}`;
    },
  },
  LICENSE_MODULE: {
    label: "Modul",
    describe: (e) => e.AFTER?.LABEL_DE || e.ENTITY_REF || "—",
  },
  LICENSE_CAPABILITY: {
    label: "Capability",
    describe: (e) => e.AFTER?.LABEL_DE || e.ENTITY_REF || "—",
  },
  CAPABILITY_PERMISSION: {
    label: "Funktions-Zuordnung",
    describe: (e) => {
      const [capKey, permKey] = String(e.ENTITY_REF || "").split(":");
      const cap = e.CONTEXT?.capability_label || capKey || "";
      const perm = e.CONTEXT?.permission_label || permKey;
      return perm ? `${cap} → ${perm}` : cap;
    },
  },
  TENANT_LICENSE: {
    label: "Mandanten-Lizenz",
    describe: (e) => {
      const name = e.CONTEXT?.tenant_name || `Mandant #${e.ENTITY_REF}`;
      const plan = e.CONTEXT?.plan_name;
      return plan ? `${name} · ${plan}` : name;
    },
  },
  TENANT_ENTITLEMENT_OVERRIDE: {
    label: "Lizenz-Ausnahme",
    describe: (e) => {
      const [tenantId, capKey] = String(e.ENTITY_REF || "").split(":");
      const name = e.CONTEXT?.tenant_name || `Mandant #${tenantId}`;
      return `${name} · ${e.CONTEXT?.capability_label || capKey || ""}`;
    },
  },
  CONSOLE_AUTH: {
    label: "Konsolen-Anmeldung",
    describe: (e) => e.ENTITY_REF || e.ACTOR || "—",
  },
  SUGGESTION: {
    label: "Vorschlag",
    describe: (e) => e.CONTEXT?.title || `Vorschlag #${e.ENTITY_REF}`,
  },
  SUGGESTION_COMMENT: {
    label: "Vorschlags-Kommentar",
    describe: (e) => `Kommentar #${e.ENTITY_REF}`,
  },
  SERVICE_REQUEST: {
    label: "Anfrage",
    describe: (e) => e.CONTEXT?.subject || `Anfrage #${e.ENTITY_REF}`,
  },
};

/** ACTION -> sprechendes Verb. Je Entity feiner, sonst generisch. */
const ACTION_LABELS = {
  create: "Angelegt",
  update: "Geändert",
  delete: "Gelöscht",
  login: "Anmeldung erfolgreich",
  login_failed: "Anmeldung fehlgeschlagen",
  publish: "Veröffentlicht",
  decline: "Abgelehnt",
  merge: "Zusammengeführt",
  respond: "Beantwortet",
  status: "Status geändert",
  lifecycle: "Fortschritt geändert",
  reply: "Beantwortet",
  jira: "Jira-Vorgang erstellt",
};

/** Feinere Verben, wo „Geändert" zu unscharf wäre. */
const ACTION_BY_ENTITY = {
  PLAN_CAPABILITY: { update: "Zu Plan hinzugefügt", delete: "Aus Plan entfernt", create: "Zu Plan hinzugefügt" },
  CAPABILITY_PERMISSION: { create: "Funktion zugeordnet", update: "Funktion zugeordnet", delete: "Zuordnung entfernt" },
  TENANT_LICENSE: { create: "Lizenz vergeben", update: "Lizenz geändert", delete: "Lizenz entfernt" },
  TENANT_ENTITLEMENT_OVERRIDE: { create: "Ausnahme erteilt", update: "Ausnahme geändert", delete: "Ausnahme aufgehoben" },
};

/**
 * Reichert einen Log-Eintrag um sprechende Felder an (rein darstellend —
 * die gespeicherten Werte bleiben unverändert).
 */
function describeEntry(entry) {
  const meta = ENTITY_LABELS[entry.ENTITY];
  const actionLabel =
    ACTION_BY_ENTITY[entry.ENTITY]?.[entry.ACTION] || ACTION_LABELS[entry.ACTION] || entry.ACTION;
  let objectLabel;
  try {
    objectLabel = meta?.describe(entry) || entry.ENTITY_REF || "—";
  } catch {
    objectLabel = entry.ENTITY_REF || "—";
  }
  return {
    ...entry,
    ACTION_LABEL: actionLabel,
    ENTITY_LABEL: meta?.label || entry.ENTITY,
    OBJECT_LABEL: objectLabel,
  };
}

module.exports = { writeChangeLog, describeEntry, ENTITY_LABELS, ACTION_LABELS };
