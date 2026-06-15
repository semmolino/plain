"use strict";

const { computeEntitlement } = require("../middleware/license");

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
