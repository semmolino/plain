"use strict";

// Wächter für die Löschprüfungen (services/dependencyCheck.js).
//
// safeReferences() schluckt jeden Fehler und meldet dann „keine Verweise" —
// eine Abfrage auf eine Spalte, die es nicht gibt, lässt das Löschen also
// still durch. Genau so prüften Adresse und Kontakt monatelang
// INVOICE.ADDRESS_ID statt INVOICE.INVOICE_ADDRESS_ID: Rechnungen und
// Abschläge blockierten nie, erst der Fremdschlüssel der Datenbank hielt das
// Löschen auf — mit einem allgemeinen 500er statt „verwendet in …".
//
// Deshalb hier jede Tabelle, jede Filterspalte und jede gelesene Spalte gegen
// das Schema-Inventar.

const fs = require("fs");
const path = require("path");
const { load } = require("./helpers/schemaInventory");

const SRC = fs.readFileSync(path.join(__dirname, "..", "services", "dependencyCheck.js"), "utf8");
const CALL = /safeReferences\(supabase,\s*"([A-Z0-9_]+)",\s*"([^"]+)",\s*\{([^}]*)\}\)/g;

const calls = [...SRC.matchAll(CALL)].map(m => ({
  table: m[1],
  select: m[2].split(",").map(s => s.trim()).filter(Boolean),
  filter: [...m[3].matchAll(/([A-Z0-9_]+)\s*:/g)].map(x => x[1]),
  line: SRC.slice(0, m.index).split("\n").length,
}));

const inventory = load();
const maybe = inventory ? describe : describe.skip;

maybe("dependencyCheck: Spalten gegen das Schema", () => {
  test("findet die Aufrufe", () => {
    expect(calls.length).toBeGreaterThan(30);
  });

  test.each(calls.map(c => [`${c.table} (Zeile ${c.line})`, c]))("%s", (_name, c) => {
    const cols = inventory.get(c.table);
    expect(cols).toBeDefined();
    const unknown = [...c.select, ...c.filter].filter(col => !cols.has(col));
    expect(unknown).toEqual([]);
  });
});
