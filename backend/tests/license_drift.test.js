"use strict";

const fs = require("fs");
const path = require("path");

const { runDriftCheck } = require("../licensing/driftCheck");
const registry = require("../licensing/registry");
const seedGen = require("../licensing/generateSeedSql");
const docsGen = require("../licensing/generateDocs");

const norm = (s) => s.replace(/\r\n/g, "\n");

describe("License Drift-Check", () => {
  it("Manifest hat keine Integritätsfehler", () => {
    const { errors } = registry.validateManifest();
    expect(errors).toEqual([]);
  });

  it("kein Drift (keine Fehler)", () => {
    const { errors } = runDriftCheck();
    if (errors.length) console.error("Drift-Fehler:\n" + errors.join("\n"));
    expect(errors).toEqual([]);
  });

  it("jede metered-Capability hat eine Einheit", () => {
    for (const c of registry.getCapabilities()) {
      if (c.type === "metered") expect(typeof c.unit).toBe("string");
    }
  });
});

describe("Generierte Artefakte sind aktuell", () => {
  it("0070b Seed-SQL stimmt mit dem Manifest überein (sonst: npm run license:gen)", () => {
    const file = path.join(__dirname, "..", "migrations", "0070b_license_capabilities_seed.sql");
    const onDisk = norm(fs.readFileSync(file, "utf8"));
    expect(onDisk).toBe(norm(seedGen.build()));
  });

  it("LICENSE_CAPABILITIES.md stimmt mit dem Manifest überein (sonst: npm run license:gen)", () => {
    const file = path.join(__dirname, "..", "..", "docs", "LICENSE_CAPABILITIES.md");
    const onDisk = norm(fs.readFileSync(file, "utf8"));
    expect(onDisk).toBe(norm(docsGen.build()));
  });
});
