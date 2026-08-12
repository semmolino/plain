"use strict";

// ============================================================================
// objectStorage.js — eine Ablage fuer alle Dateien der Anwendung
//
// WARUM ES DAS GIBT
//   Bis hierher schrieben neun Stellen direkt mit fs.* nach backend/uploads/.
//   Auf Railway ging das gut, weil der Container ein dauerhaftes Dateisystem
//   hat. Scalingo hat keins: nach jedem Deploy ist das Verzeichnis leer. Bei
//   Logos waere das aergerlich, bei erzeugten Rechnungs-PDFs ist es ein
//   Aufbewahrungsproblem.
//
//   Statt an neun Stellen ein S3-SDK einzustreuen, liegt hier eine schmale
//   Schnittstelle. Dahinter zwei Treiber:
//       local  Dateisystem, unveraendertes Verhalten — Standard fuer Entwicklung
//       s3     S3-kompatibler Objektspeicher (Impossible Cloud) — fuer Betrieb
//
//   Der Wechsel ist damit eine Umgebungsvariable, kein Codeeingriff. Und ein
//   spaeterer Anbieterwechsel ist Endpunkt + Schluessel + Bucket, sonst nichts.
//
// DER SCHLUESSEL
//   Angesprochen wird ueber denselben STORAGE_KEY, der bereits in ASSET und in
//   den Anhang-Tabellen steht — z.B. "4/generated/8f3c….pdf". Der Wert war
//   schon immer ein relativer, plattformunabhaengiger Pfad und ist damit ohne
//   Umrechnung als Objektschluessel verwendbar. Es braucht KEINE Migration der
//   Datenbank: dieselben Zeilen zeigen vorher auf eine Datei und nachher auf
//   ein Objekt.
//
// KONFIGURATION
//   STORAGE_DRIVER        local (Standard) | s3
//   S3_ENDPOINT           z.B. https://<region>.storage.impossibleapi.net
//   S3_REGION             Regionsname des Anbieters
//   S3_BUCKET             Name des Buckets
//   S3_ACCESS_KEY_ID      Zugangsschluessel
//   S3_SECRET_ACCESS_KEY  Geheimnis
//   S3_FORCE_PATH_STYLE   true (Standard) — die meisten S3-kompatiblen
//                         Anbieter erwarten Pfad- statt Host-Adressierung
// ============================================================================

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

// ── Schluesselpruefung ──────────────────────────────────────────────────────
// Die Schluessel stammen aus der Datenbank und werden ausschliesslich
// serverseitig erzeugt. Trotzdem wird hier geprueft: beim lokalen Treiber wird
// aus dem Schluessel ein Dateipfad, und ein ".." darin liesse einen Leseaufruf
// aus dem uploads-Verzeichnis herauslaufen. Die Pruefung kostet nichts und
// haelt die Zusicherung an EINER Stelle statt an neun.
function assertSafeKey(key) {
  const k = String(key || "");
  if (!k) throw new Error("Speicherschluessel fehlt");
  if (k.includes("..") || k.startsWith("/") || k.startsWith("\\") || /^[a-zA-Z]:/.test(k)) {
    throw new Error(`Ungueltiger Speicherschluessel: ${k}`);
  }
  return k.replace(/\\/g, "/");
}

// ============================================================================
// Treiber: lokales Dateisystem
// ============================================================================

function createLocalDriver() {
  // LOCAL_STORAGE_ROOT ist normalerweise nicht gesetzt — der Standard ist
  // exakt das bisherige Verzeichnis. Die Variable existiert, damit Tests und
  // das Umzugsskript gegen ein eigenes Verzeichnis arbeiten koennen, ohne die
  // echten Uploads anzufassen.
  const root = process.env.LOCAL_STORAGE_ROOT || path.join(__dirname, "..", "uploads");

  const abs = (key) => path.join(root, assertSafeKey(key));

  return {
    name: "local",

    async put(key, buffer, { contentType } = {}) {
      void contentType; // im Dateisystem gibt es keinen Content-Type
      const target = abs(key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
    },

    async getBuffer(key) {
      const target = abs(key);
      if (!fs.existsSync(target)) return null;
      return fs.readFileSync(target);
    },

    async getStream(key) {
      const target = abs(key);
      if (!fs.existsSync(target)) return null;
      return {
        stream: fs.createReadStream(target),
        contentLength: fs.statSync(target).size,
        contentType: null,
      };
    },

    async exists(key) {
      return fs.existsSync(abs(key));
    },

    async remove(key) {
      const target = abs(key);
      // Ein fehlendes Objekt ist kein Fehler — Loeschen ist idempotent, damit
      // ein zweiter Aufruf (Wiederholung, paralleler Request) nicht bricht.
      try { fs.unlinkSync(target); } catch { /* schon weg */ }
    },
  };
}

// ============================================================================
// Treiber: S3-kompatibler Objektspeicher
// ============================================================================

function createS3Driver() {
  // Bewusst erst hier geladen, nicht am Dateikopf. Wer lokal mit dem
  // Standardtreiber arbeitet, braucht das SDK nicht installiert zu haben —
  // und die Jest-Tests kommen ohne Netzwerkabhaengigkeit aus.
  const {
    S3Client, PutObjectCommand, GetObjectCommand,
    HeadObjectCommand, DeleteObjectCommand,
  } = require("@aws-sdk/client-s3");

  const bucket = process.env.S3_BUCKET;
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "eu-central-1",
    // Host-Adressierung (bucket.endpunkt) setzt einen passenden DNS-Eintrag und
    // ein Wildcard-Zertifikat beim Anbieter voraus. Pfad-Adressierung
    // (endpunkt/bucket) funktioniert immer — deshalb der Standard.
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  // Fehlt ein Objekt, antwortet S3 je nach Anbieter mit NoSuchKey, NotFound
  // oder schlicht 404. Alle drei bedeuten dasselbe und muessen zu null werden,
  // nicht zu einer Ausnahme — die Aufrufer pruefen auf null, so wie sie vorher
  // auf fs.existsSync geprueft haben.
  const isMissing = (err) => {
    const name = err?.name || err?.Code || "";
    return name === "NoSuchKey" || name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
  };

  return {
    name: "s3",

    async put(key, buffer, { contentType } = {}) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: assertSafeKey(key),
        Body: buffer,
        ContentType: contentType || "application/octet-stream",
      }));
    },

    async getBuffer(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }));
        const chunks = [];
        for await (const chunk of out.Body) chunks.push(chunk);
        return Buffer.concat(chunks);
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },

    async getStream(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }));
        return {
          // Body ist unter Node bereits ein Readable; die Umwandlung deckt
          // aeltere SDK-Rueckgaben (Web-Stream) mit ab.
          stream: out.Body instanceof Readable ? out.Body : Readable.fromWeb(out.Body),
          contentLength: out.ContentLength ?? null,
          contentType: out.ContentType ?? null,
        };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }));
        return true;
      } catch (err) {
        if (isMissing(err)) return false;
        throw err;
      }
    },

    async remove(key) {
      // S3 meldet auch dann Erfolg, wenn der Schluessel nicht existierte —
      // dasselbe idempotente Verhalten wie beim lokalen Treiber.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }));
    },
  };
}

// ============================================================================
// Auswahl und Konfigurationspruefung
// ============================================================================

const DRIVER = String(process.env.STORAGE_DRIVER || "local").toLowerCase();

let driver = null;
function getDriver() {
  if (!driver) driver = DRIVER === "s3" ? createS3Driver() : createLocalDriver();
  return driver;
}

// Vom server.js beim Start aufgerufen. Ohne diese Pruefung faellt eine
// vergessene Variable erst beim ersten Datei-Upload auf — im Zweifel Tage
// spaeter und beim Kunden statt beim Deploy.
const PFLICHT = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];

function assertConfigured() {
  if (DRIVER !== "s3") return;

  const fehlend = PFLICHT.filter((v) => !process.env[v]);
  if (fehlend.length) {
    throw new Error(
      `STORAGE_DRIVER=s3, aber folgende Variablen fehlen: ${fehlend.join(", ")}`
    );
  }

  // Auf Platzhalter pruefen. Klingt uebertrieben, ist es nicht: beim Einrichten
  // wurden die spitzen Klammern aus der Beispielzeile mituebernommen
  // (S3_REGION="<region>"). Die Variablen waren damit "gesetzt", die App startete
  // — und erst der erste Datei-Upload scheiterte, mit einer Meldung ueber
  // ungueltige Hostnamen, die den Zusammenhang nicht erkennen laesst.
  // In keinem dieser Werte kommt je eine spitze Klammer oder ein "…" vor.
  const platzhalter = [...PFLICHT, "S3_REGION"]
    .filter((v) => /[<>…]/.test(process.env[v] || ""));
  if (platzhalter.length) {
    throw new Error(
      `Diese Variablen enthalten noch Platzhalter statt echter Werte: ${platzhalter.join(", ")}`
    );
  }
}

module.exports = {
  put:       (key, buffer, opts) => getDriver().put(key, buffer, opts),
  getBuffer: (key)               => getDriver().getBuffer(key),
  getStream: (key)               => getDriver().getStream(key),
  exists:    (key)               => getDriver().exists(key),
  remove:    (key)               => getDriver().remove(key),
  driverName: ()                 => DRIVER,
  assertConfigured,
  assertSafeKey,
  // Nur fuer Tests: erlaubt, den zwischengespeicherten Treiber zu verwerfen.
  _resetForTests: () => { driver = null; },
};
