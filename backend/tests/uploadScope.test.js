"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Der Mandanten-Kontext muss einen Datei-Upload überleben.
//
// BEFUND 2026-09-19: Der Adressimport brach ab, sobald geschrieben wurde —
//     new row violates row-level security policy for table "IMPORT_BATCH"
// obwohl die TENANT_ID in der Nutzlast stand. Ursache war nicht die Policy,
// sondern der fehlende Claim: multer liest den multipart-Rumpf aus
// Stream-Ereignissen, und die löst der HTTP-Parser im Kontext des SERVERS aus,
// nicht in dem, den tenantScope mit als.run() aufgespannt hat. Alles hinter
// upload.single(...) lief deshalb claimlos.
//
// Bitter daran war die Vorschau: sie SCHRIEB nichts, las den Bestand also
// gegen eine leere Datenbank und meldete "0 Dubletten" — plausibel aussehend
// und falsch. Nur der Schreibzugriff fiel auf.
//
// Der Test prüft beide Seiten: dass die Brücke trägt, und — als Begründung,
// warum es sie geben muss — dass es ohne sie bricht.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { AsyncLocalStorage } = require("node:async_hooks");

process.env.PGRST_JWT_SECRET = process.env.PGRST_JWT_SECRET || "test-geheimnis-lang-genug";
const { keepScope } = require("../db");

const als = new AsyncLocalStorage();
const upload = multer({ storage: multer.memoryStorage() });

/** Startet einen Server, schickt eine Datei hin, liefert den dort sichtbaren Kontext. */
async function kontextNachUpload(mw) {
  const app = express();
  // Steht für tenantScope: spannt den Mandanten über den Rest der Kette auf.
  app.use((_req, _res, next) => als.run({ tenant_id: 13 }, next));
  app.post("/hoch", mw, (_req, res) => res.json({ kontext: als.getStore() || null }));

  const srv = app.listen(0);
  await new Promise((f) => srv.once("listening", f));
  try {
    const fd = new FormData();
    fd.append("file", new Blob(["Name 1;Ort\nMuster GmbH;Berlin\n"]), "adressen.csv");
    const antwort = await fetch(`http://127.0.0.1:${srv.address().port}/hoch`, { method: "POST", body: fd });
    return (await antwort.json()).kontext;
  } finally {
    srv.close();
  }
}

describe("Mandanten-Kontext über multer hinweg", () => {
  it("geht ohne keepScope verloren — das war der Fehler", async () => {
    expect(await kontextNachUpload(upload.single("file"))).toBeNull();
  });

  it("bleibt mit keepScope erhalten", async () => {
    expect(await kontextNachUpload(keepScope(upload.single("file")))).toEqual({ tenant_id: 13 });
  });

  it("reicht auch den Fehler eines abgewiesenen Uploads weiter", async () => {
    const nurBilder = multer({
      storage: multer.memoryStorage(),
      fileFilter: (_req, _file, cb) => cb(Object.assign(new Error("abgelehnt"), { status: 400 })),
    });

    const app = express();
    app.use((_req, _res, next) => als.run({ tenant_id: 13 }, next));
    app.post("/hoch", keepScope(nurBilder.single("file")), (_req, res) => res.json({ ok: true }));
    // Fehlerbehandler: muss den Fehler UND den Kontext sehen.
    app.use((err, _req, res, _next) => res.status(400).json({ fehler: err.message, kontext: als.getStore() || null }));

    const srv = app.listen(0);
    await new Promise((f) => srv.once("listening", f));
    try {
      const fd = new FormData();
      fd.append("file", new Blob(["x"]), "x.csv");
      const antwort = await fetch(`http://127.0.0.1:${srv.address().port}/hoch`, { method: "POST", body: fd });
      expect(await antwort.json()).toEqual({ fehler: "abgelehnt", kontext: { tenant_id: 13 } });
    } finally {
      srv.close();
    }
  });
});

// Die Brücke nützt nur dort, wo sie auch steht. Eine weitere multer-Route
// müsste sie sonst neu entdecken — über denselben Weg: einen Upload, der ohne
// Fehlermeldung nichts tut.
describe("jede multer-Route trägt die Brücke", () => {
  const ROUTEN = path.join(__dirname, "..", "routes");
  const VERBEN = "single|array|fields|any";

  it("kein multer-Handler ohne keepScope", () => {
    const befunde = [];
    for (const datei of fs.readdirSync(ROUTEN).filter((d) => d.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(ROUTEN, datei), "utf8");

      // Erst die multer-Instanzen der Datei sammeln. Ohne diese Eingrenzung
      // schlüge der Wächter bei jedem .single() von PostgREST an — das hat mit
      // Uploads nichts zu tun und käme in fast jeder Route vor.
      const instanzen = [...text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*multer\s*\(/g)].map((m) => m[1]);
      if (!instanzen.length) continue;
      const verben = VERBEN.split("|");
      const trifft = (zeile) => instanzen.some((n) => verben.some((v) => zeile.includes(n + "." + v + "(")));

      text.split(/\r?\n/).forEach((zeile, i) => {
        // Kommentarzeilen erklären das Muster, sie verwenden es nicht.
        if (/^\s*(\/\/|\*)/.test(zeile)) return;
        if (!trifft(zeile)) return;
        if (/keepScope\s*\(/.test(zeile)) return;
        befunde.push(`${datei}:${i + 1}: ${zeile.trim()}`);
      });
    }
    expect(befunde).toEqual([]);
  });
});
