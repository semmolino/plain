"use strict";

/**
 * Inbox-Regeln — berechnet die offenen Lizenz-Aufgaben ("Drift") aus einem
 * Schnappschuss von Manifest + Datenbank + Code-Gates.
 *
 * Bewusst PURE: kein DB-, Datei- oder Express-Zugriff. Die Owner-Konsole holt
 * den Schnappschuss (services/inbox.js) und ruft hier `buildInbox()` auf.
 * Dadurch ist jede Regel in Jest testbar (backend/tests/license_inbox.test.js).
 *
 * Warum überhaupt: Bisher meldete die Inbox nur "Capability in keinem Plan".
 * Da der interne Plan 'full' per CROSS JOIN ALLE Capabilities enthält, war diese
 * Bedingung nie erfüllt -> die Inbox blieb dauerhaft leer, obwohl seit Monaten
 * neue Funktionen ohne Lizenz-Zuordnung dazugekommen sind. Die Regeln unten
 * decken jetzt jede Drift-Art zwischen Code, Manifest und DB ab.
 */

const registry = require("./registry");

/** Interne Pläne zählen nicht als "paketiert" — sie enthalten per Definition alles. */
const INTERNAL_PLAN_KEYS = new Set(["full"]);

const SEVERITY_ORDER = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };

/**
 * @typedef {Object} InboxSnapshot
 * @property {{key:string,label:string,module:string}[]} catalogPermissions  PERMISSION (DB)
 * @property {{capabilityKey:string,permissionKey:string}[]} capabilityPermissionLinks CAPABILITY_PERMISSION (DB)
 * @property {{id:number,key:string,nameDe:string,isActive:boolean}[]} plans LICENSE_PLAN (DB)
 * @property {{planId:number,capabilityKey:string}[]} planCapabilities PLAN_CAPABILITY (DB)
 * @property {string[]} dbCapabilityKeys LICENSE_CAPABILITY (DB)
 * @property {{id:number,name:string}[]} tenants TENANTS (DB)
 * @property {number[]} licensedTenantIds TENANT_LICENSE.TENANT_ID (DB)
 * @property {Record<string,string[]>} gateUsage  Capability-Key -> Fundstellen im Code
 */

/**
 * Baut die Aufgabenliste der Inbox.
 * @param {InboxSnapshot} snapshot
 * @returns {{items:object[], counts:Record<string,number>, bySeverity:Record<string,number>}}
 */
function buildInbox(snapshot) {
  const {
    catalogPermissions = [],
    capabilityPermissionLinks = [],
    plans = [],
    planCapabilities = [],
    dbCapabilityKeys = [],
    tenants = [],
    licensedTenantIds = [],
    gateUsage = {},
  } = snapshot || {};

  const items = [];
  const manifestCaps = registry.getCapabilities();
  const manifestCapKeys = new Set(manifestCaps.map((c) => c.key));
  const capLabel = new Map(manifestCaps.map((c) => [c.key, c.labelDe]));

  // ── 1. Neue Funktion ohne Capability ───────────────────────────────────────
  // Der Kernfall: jede neue Funktion bekommt ein RBAC-Recht (CLAUDE.md-Regel).
  // Ist dieses Recht keiner Capability zugeordnet, ist die Funktion nicht
  // lizenzierbar — sie landet stillschweigend in JEDEM Plan.
  const mappedPermissions = new Set(capabilityPermissionLinks.map((l) => l.permissionKey));
  for (const p of catalogPermissions) {
    if (mappedPermissions.has(p.key)) continue;
    items.push({
      kind: "permission_unmapped",
      severity: "hoch",
      ref: p.key,
      title: p.label || p.key,
      detail:
        `Die Funktion „${p.label || p.key}“ (Modul ${p.module || "—"}) ist keiner Capability zugeordnet ` +
        `und damit nicht lizenzierbar — sie ist derzeit in jedem Plan enthalten.`,
      action: "Einer bestehenden Capability zuordnen oder eine neue Capability im Manifest anlegen.",
      targetTab: "functions",
    });
  }

  // ── 2. Capability in keinem kundenfähigen Plan ─────────────────────────────
  // 'full' (intern) wird ausgeklammert, sonst ist die Regel wirkungslos.
  const sellablePlanIds = new Set(
    plans.filter((p) => p.isActive && !INTERNAL_PLAN_KEYS.has(p.key)).map((p) => p.id)
  );
  const packagedCaps = new Set(
    planCapabilities.filter((pc) => sellablePlanIds.has(pc.planId)).map((pc) => pc.capabilityKey)
  );
  if (sellablePlanIds.size > 0) {
    for (const c of manifestCaps) {
      if (packagedCaps.has(c.key)) continue;
      items.push({
        kind: "capability_unpackaged",
        severity: "mittel",
        ref: c.key,
        title: c.labelDe,
        detail: `Die Capability „${c.labelDe}“ ist in keinem verkaufbaren Plan enthalten — kein Kunde kann sie erhalten.`,
        action: "In der Matrix mindestens einem Plan zuordnen (oder bewusst als Enterprise-Only belassen).",
        targetTab: "matrix",
      });
    }
  }

  // ── 3. Manifest-Capability fehlt in der DB ─────────────────────────────────
  // Zeigt an, dass der Seed (0070b) nach einer Manifest-Erweiterung nicht
  // eingespielt wurde. Ohne DB-Zeile schlägt jede Plan-Zuordnung am FK fehl.
  const dbCaps = new Set(dbCapabilityKeys);
  if (dbCapabilityKeys.length > 0) {
    for (const c of manifestCaps) {
      if (dbCaps.has(c.key)) continue;
      items.push({
        kind: "capability_missing_in_db",
        severity: "kritisch",
        ref: c.key,
        title: c.labelDe,
        detail:
          `Die Capability „${c.labelDe}“ steht im Code-Manifest, fehlt aber in der Tabelle LICENSE_CAPABILITY. ` +
          `Jede Plan-Zuordnung schlägt mit einem Fremdschlüssel-Fehler fehl.`,
        action: "Migration 0070b neu generieren (npm run license:gen) und in Supabase einspielen.",
        targetTab: "inbox",
      });
    }

    // ── 4. Capability nur in der DB (in der Konsole angelegt) ────────────────
    // Seit dem Capability-Management ist die DB die editierbare Quelle: eine hier
    // angelegte Capability steht bewusst nicht im Manifest. Das ist kein Fehler,
    // nur nicht „deploy-fest" — bei Neuaufbau der DB aus dem Manifest-Seed fehlt sie.
    for (const key of dbCaps) {
      if (manifestCapKeys.has(key)) continue;
      items.push({
        kind: "capability_db_only",
        severity: "niedrig",
        ref: key,
        title: key,
        detail:
          `Die Capability „${key}“ wurde in der Konsole angelegt und steht nicht im Code-Manifest. ` +
          `Das ist in Ordnung — bei einem Neuaufbau der DB aus dem Seed wäre sie aber nicht dabei.`,
        action: "Optional ins Manifest (capabilities.manifest.js) übernehmen, damit sie deploy-fest ist.",
        targetTab: "functions",
      });
    }
  }

  // ── 5. Zuordnung weicht vom Manifest ab ────────────────────────────────────
  // Die DB ist die gültige Quelle (über die Konsole editierbar); das Manifest
  // war nur der Erst-Seed. Divergenz ist erlaubt, muss aber sichtbar sein —
  // sonst überschreibt ein erneutes Einspielen von 0070b die Handarbeit.
  if (dbCapabilityKeys.length > 0) {
    const manifestLinks = new Set(
      registry.capabilityPermissionLinks().map((l) => `${l.capabilityKey} ${l.permissionKey}`)
    );
    const dbLinks = new Set(capabilityPermissionLinks.map((l) => `${l.capabilityKey} ${l.permissionKey}`));
    for (const link of dbLinks) {
      if (manifestLinks.has(link)) continue;
      const [capKey, permKey] = link.split(" ");
      if (!manifestCapKeys.has(capKey)) continue; // schon als verwaist gemeldet
      items.push({
        kind: "link_only_in_db",
        severity: "niedrig",
        ref: `${capKey}:${permKey}`,
        title: `${capLabel.get(capKey) || capKey} → ${permKey}`,
        detail:
          `Die Zuordnung wurde in der Konsole gesetzt, steht aber nicht im Code-Manifest. ` +
          `Ein erneutes Einspielen von 0070b würde sie nicht enthalten.`,
        action: "Zuordnung ins Manifest übernehmen (capabilities.manifest.js), damit sie deploy-fest ist.",
        targetTab: "functions",
      });
    }
    for (const link of manifestLinks) {
      if (dbLinks.has(link)) continue;
      const [capKey, permKey] = link.split(" ");
      items.push({
        kind: "link_only_in_manifest",
        severity: "niedrig",
        ref: `${capKey}:${permKey}`,
        title: `${capLabel.get(capKey) || capKey} → ${permKey}`,
        detail:
          `Das Manifest ordnet diese Funktion der Capability zu, die Datenbank nicht ` +
          `(in der Konsole entfernt oder Seed nie eingespielt).`,
        action: "Entweder in der Konsole wieder zuordnen oder aus dem Manifest entfernen.",
        targetTab: "functions",
      });
    }
  }

  // ── 6. Zuordnung zeigt auf ein nicht existierendes Recht ───────────────────
  if (catalogPermissions.length > 0) {
    const catalogKeys = new Set(catalogPermissions.map((p) => p.key));
    for (const l of capabilityPermissionLinks) {
      if (catalogKeys.has(l.permissionKey)) continue;
      items.push({
        kind: "link_dangling_permission",
        severity: "hoch",
        ref: `${l.capabilityKey}:${l.permissionKey}`,
        title: `${capLabel.get(l.capabilityKey) || l.capabilityKey} → ${l.permissionKey}`,
        detail: `Die Capability verweist auf das Recht „${l.permissionKey}“, das es im RBAC-Katalog nicht (mehr) gibt.`,
        action: "Zuordnung entfernen oder das Recht im Katalog anlegen.",
        targetTab: "functions",
      });
    }
  }

  // ── 7. Capability ohne Wirkung im Code ─────────────────────────────────────
  // Eine Capability ohne Code-Gate UND ohne verknüpfte Rechte wirkt nirgends:
  // sie lässt sich verkaufen, schaltet aber faktisch nichts frei/ab.
  const linkedCaps = new Set(capabilityPermissionLinks.map((l) => l.capabilityKey));
  for (const c of manifestCaps) {
    const hasGate = Array.isArray(gateUsage[c.key]) && gateUsage[c.key].length > 0;
    if (hasGate || linkedCaps.has(c.key)) continue;
    items.push({
      kind: "capability_ungated",
      severity: "mittel",
      ref: c.key,
      title: c.labelDe,
      detail:
        `„${c.labelDe}“ ist weder mit einem RBAC-Recht verknüpft noch im Code über ein Feature-Gate geprüft. ` +
        `Die Lizenz-Einstellung bleibt wirkungslos.`,
      action: "Im Code ein Gate setzen (requireFeature / <HasFeature>) oder Rechte zuordnen.",
      targetTab: "functions",
    });
  }

  // ── 8. Tenant ohne Lizenz ──────────────────────────────────────────────────
  // Soft-Fail in backend/middleware/license.js heißt: keine Lizenzzeile =
  // unbeschränkt. Ein neu registrierter Tenant bekommt also stillschweigend alles.
  const licensed = new Set(licensedTenantIds);
  for (const t of tenants) {
    if (licensed.has(t.id)) continue;
    items.push({
      kind: "tenant_without_license",
      severity: "hoch",
      ref: String(t.id),
      title: t.name || `Tenant #${t.id}`,
      detail:
        `Der Mandant „${t.name || t.id}“ hat keine Lizenzzeile. Die Lizenzprüfung fällt auf „unbeschränkt“ ` +
        `zurück — er nutzt derzeit faktisch alle Funktionen.`,
      action: "Im Tab „Tenants“ einen Plan zuweisen.",
      targetTab: "tenants",
    });
  }

  // ── 9. Aktiver Plan ohne Inhalt ────────────────────────────────────────────
  const capsPerPlan = new Map();
  for (const pc of planCapabilities) {
    capsPerPlan.set(pc.planId, (capsPerPlan.get(pc.planId) || 0) + 1);
  }
  for (const p of plans) {
    if (!p.isActive || (capsPerPlan.get(p.id) || 0) > 0) continue;
    items.push({
      kind: "plan_empty",
      severity: "hoch",
      ref: String(p.id),
      title: p.nameDe || p.key,
      detail: `Der aktive Plan „${p.nameDe || p.key}“ enthält keine einzige Capability — Kunden auf diesem Plan hätten keinerlei Funktionen.`,
      action: "In der Matrix Capabilities zuordnen oder den Plan deaktivieren.",
      targetTab: "matrix",
    });
  }

  items.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.kind.localeCompare(b.kind) ||
      String(a.ref).localeCompare(String(b.ref))
  );
  items.forEach((it, i) => {
    it.id = `${it.kind}:${it.ref}`;
    it.position = i;
  });

  const counts = {};
  const bySeverity = {};
  for (const it of items) {
    counts[it.kind] = (counts[it.kind] || 0) + 1;
    bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
  }
  return { items, counts, bySeverity };
}

/** Sprechende Überschriften je Aufgabenart (UI-Gruppierung). */
const KIND_LABELS = {
  permission_unmapped: "Neue Funktionen ohne Lizenz-Zuordnung",
  capability_unpackaged: "Capabilities in keinem verkaufbaren Plan",
  capability_missing_in_db: "Capabilities fehlen in der Datenbank",
  capability_db_only: "Nur in der Konsole angelegt (nicht im Manifest)",
  link_only_in_db: "Zuordnung nur in der Datenbank (nicht im Manifest)",
  link_only_in_manifest: "Zuordnung nur im Manifest (nicht in der Datenbank)",
  link_dangling_permission: "Zuordnung zeigt auf ein unbekanntes Recht",
  capability_ungated: "Capabilities ohne Wirkung im Code",
  tenant_without_license: "Mandanten ohne Lizenz",
  plan_empty: "Aktive Pläne ohne Capabilities",
};

module.exports = { buildInbox, KIND_LABELS, INTERNAL_PLAN_KEYS, SEVERITY_ORDER };
