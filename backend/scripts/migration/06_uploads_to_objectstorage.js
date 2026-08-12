#!/usr/bin/env node
"use strict";

// ============================================================================
// 06_uploads_to_objectstorage.js — Bestandsdateien in den Objektspeicher
//
// AUSFUEHREN AUF DEM RECHNER, AUF DEM backend/uploads/ VOLLSTAENDIG VORLIEGT.
// Auf Railway heisst das: vorher einmal herunterladen. Auf Scalingo gibt es
// die Dateien nicht mehr — deshalb muss dieser Schritt VOR dem Umschalten
// laufen, nicht danach.
//
//   node backend/scripts/migration/06_uploads_to_objectstorage.js --dry-run
//   node backend/scripts/migration/06_uploads_to_objectstorage.js
//
// WARUM ES DAS BRAUCHT
//   Die ASSET-Zeilen und die Anhang-Tabellen zeigen ueber STORAGE_KEY auf
//   Dateien. Der Schluessel bleibt bei der Umstellung gleich — aber das Objekt
//   dahinter muss erst einmal im Speicher ankommen. Ohne diesen Lauf zeigen
//   nach dem Umschalten alle Bestandsverweise ins Leere: jede alte Rechnung
//   waere als PDF verschwunden.
//
// WIEDERHOLBAR
//   Bereits vorhandene Objekte werden uebersprungen (--force laedt neu). Ein
//   abgebrochener Lauf kann also einfach wiederholt werden.
// ============================================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const FORCE = ARGS.includes("--force");

// Die Quelle ist IMMER das lokale Verzeichnis, das Ziel IMMER der konfigurierte
// Treiber. Deshalb wird der Adapter hier absichtlich auf "s3" gezwungen: sonst
// kopierte das Skript bei versehentlich fehlender Variable das Verzeichnis auf
// sich selbst und meldete Erfolg.
const QUELLE = process.env.LOCAL_STORAGE_ROOT || path.join(__dirname, "..", "..", "uploads");
process.env.STORAGE_DRIVER = "s3";
const storage = require("../../services/objectStorage");

const MIME = {
  ".pdf": "application/pdf", ".xml": "application/xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".doc": "application/msword", ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function* dateienUnter(wurzel, praefix = "") {
  for (const eintrag of fs.readdirSync(path.join(wurzel, praefix), { withFileTypes: true })) {
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) yield* dateienUnter(wurzel, rel);
    else if (eintrag.isFile()) yield rel;
  }
}

(async () => {
  try {
    storage.assertConfigured();
  } catch (e) {
    console.error(`FEHLER: ${e.message}`);
    console.error("Die S3-Variablen muessen gesetzt sein (.env oder Umgebung).");
    process.exit(1);
  }

  if (!fs.existsSync(QUELLE)) {
    console.error(`FEHLER: Quellverzeichnis fehlt: ${QUELLE}`);
    process.exit(1);
  }

  console.log(`Quelle : ${QUELLE}`);
  console.log(`Ziel   : ${process.env.S3_BUCKET} @ ${process.env.S3_ENDPOINT}`);
  console.log(DRY ? "Modus  : Probelauf (es wird nichts geschrieben)\n" : "Modus  : Uebertragung\n");

  let uebertragen = 0, uebersprungen = 0, fehler = 0, bytes = 0;

  for (const key of dateienUnter(QUELLE)) {
    const abs = path.join(QUELLE, key);
    const groesse = fs.statSync(abs).size;

    try {
      if (!FORCE && await storage.exists(key)) {
        uebersprungen++;
        continue;
      }
      if (!DRY) {
        const inhalt = fs.readFileSync(abs);
        const typ = MIME[path.extname(key).toLowerCase()] || "application/octet-stream";
        await storage.put(key, inhalt, { contentType: typ });
      }
      uebertragen++;
      bytes += groesse;
      if (uebertragen % 50 === 0) console.log(`  … ${uebertragen} Dateien`);
    } catch (e) {
      fehler++;
      console.error(`  FEHLER bei ${key}: ${e.message}`);
    }
  }

  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log("\n═══════════════════════════════════════════");
  console.log(` uebertragen  : ${uebertragen} (${mb} MB)`);
  console.log(` uebersprungen: ${uebersprungen} (schon vorhanden)`);
  console.log(` Fehler       : ${fehler}`);
  console.log("═══════════════════════════════════════════");

  if (fehler > 0) {
    console.error("\nNICHT umschalten, solange Dateien fehlen — die zugehoerigen");
    console.error("Belege waeren nach der Umstellung nicht mehr abrufbar.");
    process.exit(1);
  }
  if (DRY) console.log("\nProbelauf beendet. Ohne --dry-run erneut starten, um zu uebertragen.");
})();
