#!/usr/bin/env node
"use strict";

// ============================================================================
// storage-selftest.js — prueft, ob die Dateiablage wirklich funktioniert
//
//   scalingo --app planandsimple run "node backend/scripts/storage-selftest.js"
//   railway ssh   ->   node backend/scripts/storage-selftest.js
//   lokal         ->   node backend/scripts/storage-selftest.js
//
// WARUM ES DAS GIBT
//   Die Startpruefung in server.js sieht nur nach, ob die Variablen gesetzt und
//   frei von Platzhaltern sind. Ob Endpunkt, Bucket und Zugangsdaten auch
//   ZUSAMMEN funktionieren, zeigt sich erst beim ersten echten Schreibzugriff —
//   und der passierte bisher zuerst beim Nutzer.
//
//   Beim Einrichten auf Scalingo hat genau dieser Test zwei Fehler in Folge
//   gefunden, die der Start nicht bemerkt hatte: erst eine Region, die woertlich
//   "<region>" hiess, dann Zugangsdaten, die aus einem Auslassungszeichen
//   bestanden. Beide Male lief die App scheinbar sauber.
//
//   Deshalb: nach jeder Aenderung an den Speichervariablen einmal ausfuehren.
//   Der Testschluessel wird am Ende wieder geloescht.
// ============================================================================

require("dotenv").config();
const storage = require("../services/objectStorage");

const KEY = `__selftest/${process.pid}-${Date.now()}.txt`;
const INHALT = Buffer.from("plan&simple storage self-test");

function zeile(name, wert) {
  console.log(`  ${name.padEnd(9)}: ${wert}`);
}

(async () => {
  console.log("");
  zeile("Treiber", storage.driverName());
  if (storage.driverName() === "s3") {
    zeile("Bucket", process.env.S3_BUCKET);
    zeile("Endpunkt", process.env.S3_ENDPOINT);
  }
  console.log("");

  try {
    storage.assertConfigured();
  } catch (e) {
    console.error(`  FEHLER   : ${e.message}\n`);
    process.exit(1);
  }

  try {
    await storage.put(KEY, INHALT, { contentType: "text/plain" });
    zeile("schreiben", `ok — ${KEY}`);

    const da = await storage.exists(KEY);
    zeile("vorhanden", da === true ? "ja" : "NEIN");
    if (!da) throw new Error("Objekt direkt nach dem Schreiben nicht auffindbar");

    const zurueck = await storage.getBuffer(KEY);
    const gleich = zurueck && zurueck.equals(INHALT);
    zeile("lesen", gleich ? "byte-identisch" : "ABWEICHUNG");
    if (!gleich) throw new Error("Zurueckgelesener Inhalt weicht ab");

    // Der Strom wird separat geprueft: die Belegausgabe (PDF-Abruf) nutzt
    // getStream, nicht getBuffer — ein Fehler dort faellt sonst nicht auf.
    const strom = await storage.getStream(KEY);
    if (!strom) throw new Error("getStream lieferte null");
    const teile = [];
    for await (const t of strom.stream) teile.push(t);
    zeile("streamen", Buffer.concat(teile).equals(INHALT) ? "byte-identisch" : "ABWEICHUNG");

    await storage.remove(KEY);
    zeile("loeschen", (await storage.exists(KEY)) === false ? "weg" : "NOCH DA");

    console.log("\n  ✓ Dateiablage funktioniert.\n");
  } catch (e) {
    console.error(`\n  ✗ FEHLGESCHLAGEN: ${e.name} — ${e.message}\n`);
    // Aufraeumen versuchen, damit ein Fehlversuch keine Reste hinterlaesst.
    await storage.remove(KEY).catch(() => {});
    process.exit(1);
  }
})();
