"use strict";

/**
 * Sammelt den Schnappschuss (DB + Code) für die Inbox und übergibt ihn an die
 * reinen Regeln in backend/licensing/inboxRules.js.
 *
 * Fehlende Lizenz-Tabellen (Migration 0070/0070b noch nicht eingespielt) werden
 * NICHT als Absturz behandelt: die betroffene Quelle liefert dann `null`, die
 * zugehörigen Regeln werden übersprungen und die Ursache erscheint als Hinweis
 * in `warnings` — sonst zeigt die Konsole eine leere Inbox und verschweigt,
 * dass sie gar nicht messen konnte.
 */

const path = require("path");
const { supabase } = require("./db");
const { buildInbox, KIND_LABELS } = require(
  path.join(__dirname, "..", "..", "backend", "licensing", "inboxRules")
);
const { scanFeatureGateUsage } = require(
  path.join(__dirname, "..", "..", "backend", "licensing", "driftCheck")
);

// Der Code-Scan läuft über das ganze Repo — Ergebnis pro Prozess zwischenspeichern.
const GATE_TTL_MS = 5 * 60_000;
let gateCache = { exp: 0, value: null };

function gateUsage() {
  const now = Date.now();
  if (gateCache.value && gateCache.exp > now) return gateCache.value;
  let value = {};
  try {
    value = Object.fromEntries(scanFeatureGateUsage());
  } catch (e) {
    console.warn("[inbox] Code-Scan fehlgeschlagen:", e?.message || e);
  }
  gateCache = { exp: now + GATE_TTL_MS, value };
  return value;
}

function isMissingRelation(err) {
  return err && /relation .* does not exist|Could not find the table/i.test(err.message || "");
}

/**
 * Holt eine Tabelle tolerant: `null` (statt Absturz), wenn sie fehlt.
 * @returns {Promise<{rows:any[]|null, warning:string|null}>}
 */
async function fetchTable(table, columns, label) {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) {
    if (isMissingRelation(error)) {
      return { rows: null, warning: `Tabelle ${table} fehlt — ${label} kann nicht geprüft werden (Migration 0070/0070b einspielen).` };
    }
    return { rows: null, warning: `${table} konnte nicht gelesen werden: ${error.message}` };
  }
  return { rows: data || [], warning: null };
}

/** Baut die komplette Inbox. */
async function loadInbox() {
  const warnings = [];
  const take = (r) => {
    if (r.warning) warnings.push(r.warning);
    return r.rows;
  };

  const [perms, links, plans, planCaps, dbCaps, tenants, tenantLic] = await Promise.all([
    fetchTable("PERMISSION", "KEY, LABEL_DE, MODULE", "neue Funktionen ohne Zuordnung"),
    fetchTable("CAPABILITY_PERMISSION", "CAPABILITY_KEY, PERMISSION_KEY", "Funktions-Zuordnungen"),
    fetchTable("LICENSE_PLAN", "ID, KEY, NAME_DE, IS_ACTIVE", "Pläne"),
    fetchTable("PLAN_CAPABILITY", "PLAN_ID, CAPABILITY_KEY", "Plan-Inhalte"),
    fetchTable("LICENSE_CAPABILITY", "KEY", "Capability-Spiegel in der DB"),
    fetchTable("TENANTS", "ID, TENANT", "Mandanten"),
    fetchTable("TENANT_LICENSE", "TENANT_ID", "Mandanten-Lizenzen"),
  ]);

  const snapshot = {
    catalogPermissions: (take(perms) || []).map((p) => ({ key: p.KEY, label: p.LABEL_DE, module: p.MODULE })),
    capabilityPermissionLinks: (take(links) || []).map((l) => ({
      capabilityKey: l.CAPABILITY_KEY,
      permissionKey: l.PERMISSION_KEY,
    })),
    plans: (take(plans) || []).map((p) => ({
      id: p.ID, key: p.KEY, nameDe: p.NAME_DE, isActive: p.IS_ACTIVE !== false,
    })),
    planCapabilities: (take(planCaps) || []).map((pc) => ({
      planId: pc.PLAN_ID, capabilityKey: pc.CAPABILITY_KEY,
    })),
    dbCapabilityKeys: (take(dbCaps) || []).map((c) => c.KEY),
    tenants: (take(tenants) || []).map((t) => ({ id: t.ID, name: t.TENANT })),
    licensedTenantIds: (take(tenantLic) || []).map((r) => r.TENANT_ID),
    gateUsage: gateUsage(),
  };

  const { items, counts, bySeverity } = buildInbox(snapshot);
  return {
    items,
    counts,
    bySeverity,
    total: items.length,
    warnings,
    kindLabels: KIND_LABELS,
    checkedAt: new Date().toISOString(),
  };
}

/** Nur die Gesamtzahl (für das Badge in der Navigation). */
async function loadInboxCount() {
  const { total, bySeverity } = await loadInbox();
  return { total, bySeverity };
}

module.exports = { loadInbox, loadInboxCount };
