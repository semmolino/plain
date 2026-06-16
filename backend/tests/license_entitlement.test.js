"use strict";

const { computeEntitlement, suppressUnlicensed } = require("../middleware/license");

describe("suppressUnlicensed (L3-Engine)", () => {
  const map = new Map([
    ["invoices.download_xml", new Set(["einvoice.xrechnung"])],
    ["projects.calculations.view", new Set(["hoai.calculator"])],
    ["dashboard.view", new Set(["core.dashboard"])],
  ]);

  it("entfernt Rechte unlizenzierter Capabilities", () => {
    const out = suppressUnlicensed(
      new Set(["invoices.download_xml", "projects.calculations.view", "dashboard.view"]),
      new Set(["core.dashboard"]), // nur Dashboard lizenziert
      map,
    );
    expect(out.has("dashboard.view")).toBe(true);
    expect(out.has("invoices.download_xml")).toBe(false);
    expect(out.has("projects.calculations.view")).toBe(false);
  });

  it("behält Rechte ohne Capability-Zuordnung immer", () => {
    const out = suppressUnlicensed(new Set(["roles.view"]), new Set(), map);
    expect(out.has("roles.view")).toBe(true);
  });

  it("behält ein Recht, wenn EINE seiner Capabilities lizenziert ist", () => {
    const m = new Map([["x", new Set(["capA", "capB"])]]);
    expect(suppressUnlicensed(new Set(["x"]), new Set(["capB"]), m).has("x")).toBe(true);
    expect(suppressUnlicensed(new Set(["x"]), new Set(["capC"]), m).has("x")).toBe(false);
  });
});

describe("computeEntitlement", () => {
  it("übernimmt Plan-Capabilities und Limits", () => {
    const { capabilities, limits } = computeEntitlement({
      planCapabilities: [{ key: "invoices.basic", limit: null }, { key: "limits.employees", limit: 5 }],
      overrides: [],
      nowMs: 1000,
    });
    expect([...capabilities].sort()).toEqual(["invoices.basic", "limits.employees"]);
    expect(limits.get("limits.employees")).toBe(5);
  });

  it("grant fügt hinzu, revoke entfernt", () => {
    const { capabilities } = computeEntitlement({
      planCapabilities: [{ key: "a", limit: null }],
      overrides: [
        { key: "b", mode: "grant", limit: null, expiresAtMs: null },
        { key: "a", mode: "revoke", limit: null, expiresAtMs: null },
      ],
      nowMs: 1000,
    });
    expect(capabilities.has("b")).toBe(true);
    expect(capabilities.has("a")).toBe(false);
  });

  it("ignoriert abgelaufene Overrides", () => {
    const { capabilities } = computeEntitlement({
      planCapabilities: [],
      overrides: [{ key: "b", mode: "grant", limit: null, expiresAtMs: 500 }],
      nowMs: 1000,
    });
    expect(capabilities.has("b")).toBe(false);
  });

  it("grant-Override setzt/überschreibt das Limit", () => {
    const { limits } = computeEntitlement({
      planCapabilities: [{ key: "limits.projects_active", limit: 10 }],
      overrides: [{ key: "limits.projects_active", mode: "grant", limit: 99, expiresAtMs: null }],
      nowMs: 1000,
    });
    expect(limits.get("limits.projects_active")).toBe(99);
  });
});
