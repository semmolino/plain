"use strict";

/**
 * Der Migrations-Runner entscheidet, was gegen die PRODUKTIONSDATENBANK laufen
 * darf. Genau eine Eigenschaft davon ist unverhandelbar:
 *
 *   Was in APPLIED_BASELINE.txt steht, wird NIE ausgefuehrt.
 *
 * Der Grund ist historisch: bis September 2026 lief jede Migration von Hand,
 * `_migrations` ist produktiv deshalb leer, obwohl die Datenbank auf dem Stand
 * aller 153 Dateien ist. Ein Runner, der daraus "nichts angewendet" schliesst,
 * fuehrt Daten-Migrationen und Seeds ohne ON CONFLICT ein zweites Mal aus —
 * kein Fehlschlag, sondern stiller Schaden an echten Daten.
 *
 * Deshalb steht die Planung als reine Funktion getrennt und wird hier
 * geprueft: ein Refactoring, das die Regel aufweicht, faellt hier auf und
 * nicht erst im Deploy.
 */

const fs = require("fs");
const path = require("path");
const { plan, sha256 } = require("../scripts/migrate");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const BASELINE_FILE = path.join(MIGRATIONS_DIR, "APPLIED_BASELINE.txt");

/** Kleine Welt: vier Dateien, eine davon wiederholbar. */
const INHALTE = {
  "0001_alt.sql": "CREATE TABLE alt ();",
  "0002_alt.sql": "INSERT INTO alt VALUES (1);",   // NICHT wiederholbar!
  "0003_neu.sql": "CREATE TABLE neu ();",
  "0070b_seed.sql": "-- @repeatable\nINSERT INTO x VALUES (1) ON CONFLICT DO NOTHING;",
};
const read = (f) => INHALTE[f];
const files = Object.keys(INHALTE).sort();

const planen = (over = {}) =>
  plan({
    files,
    baseline: new Set(["0001_alt.sql", "0002_alt.sql"]),
    applied: new Set(),
    hashes: new Map(),
    read,
    ...over,
  });

describe("plan()", () => {
  it("führt Altbestand nicht aus — auch ohne Vermerk in _migrations", () => {
    // Das ist der produktive Zustand: applied ist leer, Baseline ist gefüllt.
    const p = planen();
    expect(p.pending).toEqual(["0003_neu.sql"]);
    expect(p.pending).not.toContain("0001_alt.sql");
    expect(p.pending).not.toContain("0002_alt.sql");
  });

  it("trägt Altbestand ohne Vermerk nach (vermerken ≠ ausführen)", () => {
    const p = planen();
    expect(p.baselineToRecord).toEqual(["0001_alt.sql", "0002_alt.sql"]);
    // … und dieselben Dateien stehen NICHT in pending.
    for (const f of p.baselineToRecord) expect(p.pending).not.toContain(f);
  });

  it("trägt nichts nach, was schon vermerkt ist", () => {
    const p = planen({ applied: new Set(["0001_alt.sql", "0002_alt.sql"]) });
    expect(p.baselineToRecord).toEqual([]);
    expect(p.pending).toEqual(["0003_neu.sql"]);
  });

  it("hält wiederholbare Dateien aus pending heraus", () => {
    const p = planen();
    expect(p.repeatables).toEqual(["0070b_seed.sql"]);
    expect(p.pending).not.toContain("0070b_seed.sql");
  });

  it("führt eine wiederholbare Datei erst bei geändertem Inhalt erneut aus", () => {
    const aktuell = sha256(INHALTE["0070b_seed.sql"]);
    // Gleicher Hash → nichts zu tun.
    expect(planen({ hashes: new Map([["0070b_seed.sql", aktuell]]) }).repeatableTodo).toEqual([]);
    // Alter Hash (z. B. nach `license:gen`) → fällig.
    expect(planen({ hashes: new Map([["0070b_seed.sql", "alt"]]) }).repeatableTodo)
      .toEqual(["0070b_seed.sql"]);
    // Kein Hash (erster Lauf) → fällig.
    expect(planen().repeatableTodo).toEqual(["0070b_seed.sql"]);
  });

  it("meldet Baseline-Einträge ohne Datei statt sie zu verschweigen", () => {
    const p = planen({ baseline: new Set(["0001_alt.sql", "0999_umbenannt.sql"]) });
    expect(p.baselineWithoutFile).toEqual(["0999_umbenannt.sql"]);
  });

  it("führt eine bereits vermerkte Datei nicht erneut aus", () => {
    const p = planen({ applied: new Set(["0003_neu.sql"]) });
    expect(p.pending).toEqual([]);
  });

  it("hält die Reihenfolge der Dateinamen ein", () => {
    const p = plan({
      files: ["0003_neu.sql", "0004_neu.sql", "0005_neu.sql"],
      baseline: new Set(),
      applied: new Set(),
      hashes: new Map(),
      read: () => "SELECT 1;",
    });
    expect(p.pending).toEqual(["0003_neu.sql", "0004_neu.sql", "0005_neu.sql"]);
  });
});

describe("APPLIED_BASELINE.txt im Repo", () => {
  const baseline = new Set(
    fs.readFileSync(BASELINE_FILE, "utf8")
      .split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
  const dateien = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  it("nennt nur Dateien, die es gibt", () => {
    expect([...baseline].filter((f) => !dateien.includes(f))).toEqual([]);
  });

  it("lässt genau die Dateien aus, die laufen sollen", () => {
    const offen = dateien.filter((f) => !baseline.has(f));
    // 0070b ist der generierte Seed (wiederholbar), 0139 die erste Migration,
    // die der Runner selbst einspielt. Kommt hier etwas Neues hinzu, ist das
    // richtig — dann gehoert es aber bewusst hierher, nicht versehentlich.
    expect(offen).toEqual([
      "0070b_license_capabilities_seed.sql",
      "0139_booking_rebook.sql",
    ]);
  });

  it("der generierte Seed traegt den @repeatable-Marker", () => {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "0070b_license_capabilities_seed.sql"), "utf8");
    expect(sql.slice(0, 2000)).toMatch(/^--\s*@repeatable\b/m);
    // Wiederholbar heisst: keine Anweisung darf beim zweiten Lauf Daten
    // vernichten. Genau deshalb steht der Marker im Generator und nicht in der
    // erzeugten Datei — er ist eine Zusage ueber deren Inhalt.
    //
    // Geprueft wird der SQL-Anteil OHNE Kommentare: der Kopf der Datei
    // erklaert die Regel im Klartext ("kein DELETE, kein TRUNCATE") und liess
    // die Zusicherung sonst an ihrer eigenen Beschreibung scheitern.
    const nurSql = sql.replace(/--[^\n]*/g, "");
    expect(nurSql).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE)\b/i);
  });
});
