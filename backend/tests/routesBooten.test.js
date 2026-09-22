"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Jede Router-Datei muss sich registrieren lassen.
//
// BEFUND 2026-09-22: Der Container kam nicht mehr hoch —
//     TypeError: Unexpected ( at 10, expected END
//     originalPath: '/:domain/:kind(errors|warnings)'
// Express 5 (path-to-regexp v8) kennt die Klammer-Syntax im Pfad nicht mehr
// und wirft SCHON BEIM REGISTRIEREN der Route, also beim Start.
//
// Warum es niemand vorher sah: die Router-Dateien exportieren eine FABRIK
//     module.exports = (supabase) => { … router.post(…) … return router }
// Ein `require()` laedt die Datei nur — die Pfade entstehen erst beim AUFRUF.
// Der uebliche Rauchtest "laedt das Modul?" beweist hier also nichts.
//
// Dieser Test ruft jede Fabrik wirklich auf. Er braucht keine Datenbank: die
// Pfade werden beim Registrieren uebersetzt, lange bevor ein Handler laeuft.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const ROUTEN = path.join(__dirname, "..", "routes");

// Attrappe: die Router reichen sie nur durch und fassen sie beim Registrieren
// nicht an.
const supabaseAttrappe = new Proxy({}, { get: () => () => supabaseAttrappe });

describe("Router lassen sich registrieren", () => {
  const dateien = fs.readdirSync(ROUTEN).filter((d) => d.endsWith(".js")).sort();

  it("findet ueberhaupt Router-Dateien", () => {
    expect(dateien.length).toBeGreaterThan(20);
  });

  it.each(dateien)("%s", (datei) => {
    const fabrik = require(path.join(ROUTEN, datei));
    // Ein Express-Router IST selbst eine Funktion. Wer direkt einen Router
    // exportiert, hat seine Pfade beim require schon registriert — dann ist
    // hier nichts mehr zu tun.
    if (typeof fabrik !== "function") return;
    if (fabrik.stack || typeof fabrik.use === "function") return;
    expect(() => fabrik(supabaseAttrappe)).not.toThrow();
  });
});
