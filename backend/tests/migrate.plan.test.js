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
    //
    // 0140/0141 gehoeren zum Umbenennungsvorhaben (Block 01, CP_* -> COST_*).
    // Je Block kommen zwei dazu: die ALTER-Anweisungen und die SQL-Objekte, die
    // ALTER nicht anfasst. Auf der Produktionsdatenbank sind sie bereits
    // vermerkt; eine frisch aufgebaute Datenbank braucht sie.
    //
    // 0076, 0095, 0133, 0134, 0135 standen faelschlich in der Baseline: dort
    // vermerkt, aber nie ausgefuehrt. Aufgefallen ist es erst durch
    // scripts/migration-drift.mjs — bis dahin waren SESSION_EPOCH (Sitzungs-
    // ruecknahme) und SIGNUP_STATE (Registrierungssperre) still wirkungslos.
    // Sie stehen jetzt ausserhalb der Baseline, damit der Deploy sie einspielt.
    //
    // 0160 zieht die zweite Linie (RLS) auf die vier Kindtabellen nach, die
    // den Mandanten nur ueber einen Fremdschluessel tragen; 0161 entfernt
    // PROJECT_HOURLY_RATES, die seit langem von niemandem mehr gelesen wird, 0162 PUSH_TOKEN (nativer Push, nie begonnen).
    // 0163 macht PAYMENT_MEANS zum globalen, schreibgeschuetzten Katalog.
    // 0164 entfernt die Unique-Regel auf ADDRESS.ADDRESS_NAME_1, die ueber alle
    // Mandanten hinweg galt und den Adressimport abbrechen liess.
    // 0166 benennt die Kostensatz-Rechte um (hiessen "Gehalt").
    // 0167 haelt die Kennung aus dem Vorsystem fest (Datenuebernahme).
    // 0168 gibt PROJECT_TYPE die Stapel-Kennung (kombinierter Projektimport).
    // 0165 ergaenzt Geburtstag, Notiz und Vorgesetzter am Mitarbeiter und die
    // Stapel-Kennung auf den vier Nebentabellen des Mitarbeiter-Imports.
    // 0169-0172 ruesten den Belegimport aus: Kennung des Vorsystems auf den
    // Belegtabellen, Stapel-Kennung auf INVOICE_DEDUCTION und SE_RELEASE
    // (ohne sie ist die Abzugskette nicht zuruecknehmbar), das Anheben des
    // Nummernkreis-Zaehlers, und die Belegart fuer bereits importierte
    // Rechnungen, die bisher ohne Typ dastanden.
    expect(offen).toEqual([
      "0070b_license_capabilities_seed.sql",
      "0076_tenant_email_domain.sql",
      "0095_import_opening_cost.sql",
      "0133_einvoice_cii_snapshot.sql",
      "0134_employee_session_epoch.sql",
      "0135_tenant_signup_approval.sql",
      "0139_booking_rebook.sql",
      "0140_01_cost_rate.sql",
      "0141_01_cost_rate_sql_objects.sql",
      "0142_02_hourly_rate.sql",
      "0143_02_hourly_rate_sql_objects.sql",
      "0144_03_role_name.sql",
      "0145_04_employee_abbr.sql",
      "0146_04_employee_abbr_sql_objects.sql",
      "0147_05_advance_invoice.sql",
      "0148_05_advance_invoice_sql_objects.sql",
      "0149_05_advance_invoice_values.sql",
      "0150_05b_advance_invoice_rest.sql",
      "0151_05b_advance_invoice_rest_sql_objects.sql",
      "0152_06_booking.sql",
      "0153_06_booking_sql_objects.sql",
      "0154_07_abbr.sql",
      "0155_07_abbr_sql_objects.sql",
      "0156_07_abbr_values.sql",
      "0157_08_name.sql",
      "0158_08_name_sql_objects.sql",
      "0159_08_name_values.sql",
      "0160_rls_kindtabellen.sql",
      "0161_drop_project_hourly_rates.sql",
      "0162_drop_push_token.sql",
      "0163_payment_means_global.sql",
      "0164_address_name_unique_weg.sql",
      "0165_employee_import_felder.sql",
      "0166_kostensatz_rechte_benennen.sql",
      "0167_legacy_ref.sql",
      "0168_project_type_import_batch.sql",
      "0169_beleg_legacy_ref.sql",
      "0170_beleg_import_batch.sql",
      "0171_bump_document_number_range.sql",
      "0172_invoice_type_backfill.sql",
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

// ── Schema-Cache ─────────────────────────────────────────────────────────────
// PostgREST liest das Schema einmal beim Start. Auf Scalingo startet der
// Web-Container VOR dem postdeploy-Hook — eine Spalte, die derselbe Deploy
// anlegt und benutzt, ist danach in der Datenbank, aber nicht im Cache. Der
// Mitarbeiter-Import ist nach Migration 0165 genau daran gescheitert
// ("Could not find the 'BIRTH_DATE' column of 'EMPLOYEE' in the schema cache"),
// obwohl die Spalte laengst da war.
describe("Schema-Cache anstossen", () => {
  const { schemaCacheNeuLaden } = require("../scripts/migrate.js");

  it("schickt ein NOTIFY auf den Kanal, auf dem PostgREST lauscht", async () => {
    const abgesetzt = [];
    await schemaCacheNeuLaden({ query: async (sql) => { abgesetzt.push(sql); } });
    expect(abgesetzt).toHaveLength(1);
    // Der Kanalname ist nicht frei waehlbar — PostgREST lauscht auf "pgrst".
    expect(abgesetzt[0]).toMatch(/NOTIFY\s+pgrst/i);
    expect(abgesetzt[0]).toMatch(/reload schema/i);
  });

  // Die Migration ist zu diesem Zeitpunkt eingespielt. Am Cache zu scheitern
  // darf den Deploy nicht umwerfen — sonst bliebe die alte Version online,
  // obwohl das Schema schon neu ist.
  it("laesst den Deploy nicht scheitern, wenn das NOTIFY nicht durchgeht", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(schemaCacheNeuLaden({
      query: async () => { throw new Error("Verbindung weg"); },
    })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
