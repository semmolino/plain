"use strict";

const { buildInbox, KIND_LABELS } = require("../licensing/inboxRules");
const registry = require("../licensing/registry");

/**
 * Vollständiger, "gesunder" Schnappschuss: alles aus dem Manifest ist in der DB
 * gespiegelt, jede Permission hängt an einer Capability, es gibt einen
 * verkaufbaren Plan, der jede Capability enthält, und jeder Tenant hat eine
 * Lizenz. Erwartung: keine offenen Aufgaben.
 */
function healthySnapshot() {
  const caps = registry.getCapabilities();
  const links = registry.capabilityPermissionLinks();
  const permKeys = [...new Set(links.map((l) => l.permissionKey))];
  return {
    catalogPermissions: permKeys.map((k) => ({ key: k, label: k, module: "x" })),
    capabilityPermissionLinks: links.map((l) => ({
      capabilityKey: l.capabilityKey,
      permissionKey: l.permissionKey,
    })),
    plans: [{ id: 1, key: "pro", nameDe: "Pro", isActive: true }],
    planCapabilities: caps.map((c) => ({ planId: 1, capabilityKey: c.key })),
    dbCapabilityKeys: caps.map((c) => c.key),
    tenants: [{ id: 10, name: "Büro A" }],
    licensedTenantIds: [10],
    // jede Capability hat ein Gate — sonst "ungated"-Hinweise
    gateUsage: Object.fromEntries(caps.map((c) => [c.key, ["x.js"]])),
  };
}

describe("Inbox-Regeln", () => {
  it("gesunder Zustand → keine Aufgaben", () => {
    const { items } = buildInbox(healthySnapshot());
    expect(items).toEqual([]);
  });

  it("neue Permission ohne Capability wird gemeldet", () => {
    const snap = healthySnapshot();
    snap.catalogPermissions.push({ key: "absence.view", label: "Abwesenheit sehen", module: "absence" });
    const { items } = buildInbox(snap);
    const it = items.find((i) => i.kind === "permission_unmapped");
    expect(it).toBeTruthy();
    expect(it.ref).toBe("absence.view");
    expect(it.severity).toBe("hoch");
  });

  it("interner 'full'-Plan maskiert fehlende Paketierung NICHT", () => {
    // 'full' (intern) enthält alle Capabilities, daneben ein verkaufbarer,
    // aber leerer Plan 'pro'. Der frühere Code prüfte „Capability in KEINEM
    // Plan" -> 'full' maskierte alles. Jetzt muss jede Capability als „in
    // keinem verkaufbaren Plan" erscheinen, weil 'pro' leer ist.
    const snap = healthySnapshot();
    snap.plans = [
      { id: 1, key: "full", nameDe: "Vollzugriff", isActive: true },
      { id: 2, key: "pro", nameDe: "Pro", isActive: true },
    ];
    snap.planCapabilities = registry.getCapabilities().map((c) => ({ planId: 1, capabilityKey: c.key }));
    const { items } = buildInbox(snap);
    const unpackaged = items.filter((i) => i.kind === "capability_unpackaged");
    expect(unpackaged.length).toBe(registry.getCapabilities().length);
  });

  it("ohne verkaufbaren Plan (nur 'full') keine Paketierungs-Warnungen", () => {
    // Vor dem ersten echten Plan ist „alles unpaketiert" kein Handlungsbedarf.
    const snap = healthySnapshot();
    snap.plans = [{ id: 1, key: "full", nameDe: "Vollzugriff", isActive: true }];
    const { items } = buildInbox(snap);
    expect(items.some((i) => i.kind === "capability_unpackaged")).toBe(false);
  });

  it("Manifest-Capability ohne DB-Zeile ist kritisch", () => {
    const snap = healthySnapshot();
    const removed = snap.dbCapabilityKeys.pop();
    const { items } = buildInbox(snap);
    const it = items.find((i) => i.kind === "capability_missing_in_db" && i.ref === removed);
    expect(it).toBeTruthy();
    expect(it.severity).toBe("kritisch");
  });

  it("verwaiste DB-Capability wird gemeldet", () => {
    const snap = healthySnapshot();
    snap.dbCapabilityKeys.push("legacy.capability");
    const { items } = buildInbox(snap);
    expect(items.some((i) => i.kind === "capability_orphaned_in_db" && i.ref === "legacy.capability")).toBe(true);
  });

  it("Zuordnung auf ein unbekanntes Recht ist hoch", () => {
    const snap = healthySnapshot();
    const cap = registry.getCapabilities()[0].key;
    snap.capabilityPermissionLinks.push({ capabilityKey: cap, permissionKey: "geloeschtes.recht" });
    const { items } = buildInbox(snap);
    const it = items.find((i) => i.kind === "link_dangling_permission");
    expect(it).toBeTruthy();
    expect(it.severity).toBe("hoch");
  });

  it("Tenant ohne Lizenz wird gemeldet", () => {
    const snap = healthySnapshot();
    snap.tenants.push({ id: 11, name: "Büro B" });
    const { items } = buildInbox(snap);
    const it = items.find((i) => i.kind === "tenant_without_license" && i.ref === "11");
    expect(it).toBeTruthy();
    expect(it.title).toContain("Büro B");
  });

  it("aktiver Plan ohne Capabilities wird gemeldet", () => {
    const snap = healthySnapshot();
    snap.plans.push({ id: 2, key: "leer", nameDe: "Leerer Plan", isActive: true });
    const { items } = buildInbox(snap);
    expect(items.some((i) => i.kind === "plan_empty" && i.ref === "2")).toBe(true);
  });

  it("fehlende DB-Quellen erzeugen keine Fehlalarme", () => {
    // Wenn Lizenz-Tabellen fehlen, liefert der Service leere Arrays statt Werte.
    // Regeln, die eine DB-Quelle brauchen, dürfen dann nicht feuern.
    const { items } = buildInbox({
      catalogPermissions: [],
      capabilityPermissionLinks: [],
      plans: [],
      planCapabilities: [],
      dbCapabilityKeys: [],
      tenants: [],
      licensedTenantIds: [],
      gateUsage: {},
    });
    // Ohne DB-Capabilities kein "missing_in_db"; ohne verkaufbare Pläne kein
    // "unpackaged"; ohne Katalog kein "dangling". Übrig bleiben höchstens
    // "ungated"-Hinweise (Manifest ohne Gate) — die sind gewollt.
    expect(items.every((i) => i.kind === "capability_ungated")).toBe(true);
  });

  it("Sortierung nach Schweregrad: kritisch zuerst", () => {
    const snap = healthySnapshot();
    snap.dbCapabilityKeys.pop(); // kritisch
    snap.tenants.push({ id: 12, name: "X" }); // hoch
    const { items } = buildInbox(snap);
    expect(items[0].severity).toBe("kritisch");
  });

  it("jede Aufgabenart hat ein Label", () => {
    const kinds = new Set([
      "permission_unmapped", "capability_unpackaged", "capability_missing_in_db",
      "capability_orphaned_in_db", "link_only_in_db", "link_only_in_manifest",
      "link_dangling_permission", "capability_ungated", "tenant_without_license", "plan_empty",
    ]);
    for (const k of kinds) expect(KIND_LABELS[k]).toBeTruthy();
  });
});
