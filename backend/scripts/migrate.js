#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Migrations-Runner
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Liest die .sql-Dateien aus backend/migrations/, merkt sich in `_migrations`,
 * was schon gelaufen ist, und spielt den Rest ein.
 *
 * AUFRUFE
 *   node scripts/migrate.js            ausstehende Migrationen einspielen
 *   node scripts/migrate.js --status   nur anzeigen, was aussteht
 *   node scripts/migrate.js --auto     Betriebsart des Deploy-Hooks (Procfile)
 *
 * VERBINDUNG
 *   DATABASE_URL, sonst SCALINGO_POSTGRESQL_URL. Auf Scalingo laeuft der
 *   postdeploy-Hook in einem One-off-Container mit der App-Umgebung, dort ist
 *   die zweite Variable gesetzt.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  DREI EIGENSCHAFTEN, DIE HIER KEINE KOMFORTFUNKTIONEN SIND
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 1. ALTBESTAND WIRD NIE AUSGEFUEHRT.
 *    Bis September 2026 lief jede Migration von Hand. `_migrations` ist
 *    produktiv deshalb leer, obwohl die Datenbank auf dem Stand aller Dateien
 *    ist. Ein Runner, der daraus "nichts angewendet" schliesst, wuerde 151
 *    Dateien erneut ausfuehren — darunter Daten-Migrationen und Seeds ohne
 *    ON CONFLICT. Deshalb gilt migrations/APPLIED_BASELINE.txt: was dort
 *    steht, wird VERMERKT und NIE AUSGEFUEHRT, auch wenn der Vermerk fehlt.
 *
 * 2. GENERIERTE SEEDS LAUFEN ERNEUT, WENN SICH IHR INHALT AENDERT.
 *    `0070b_license_capabilities_seed.sql` entsteht aus
 *    capabilities.manifest.js. Wer eine Permission an eine Capability haengt,
 *    aendert damit eine Datei, die nach Dateinamen schon "angewendet" ist —
 *    ein reiner Namensvergleich haette sie nie wieder eingespielt, und das
 *    Recht haette als "keiner Capability zugeordnet" in jedem Tarif gewirkt
 *    (fail-open). Dateien mit dem Marker `-- @repeatable` laufen deshalb
 *    ueber ihren Inhalts-Hash, nicht ueber den Namen. Sie MUESSEN
 *    wiederholbar geschrieben sein (INSERT … ON CONFLICT DO NOTHING).
 *
 * 3. EIN FEHLER IST LAUT.
 *    Der Prozess endet mit Code 1. Auf Scalingo scheitert damit der Deploy
 *    (Status hook-error) und die alte Version bleibt online. Das ist der
 *    Zweck: eine Migration, die still nicht laeuft, ist der teuerste Fall —
 *    genau so war `reports.wip.view` nach 0136 fuer alle unsichtbar.
 *
 * NOTBREMSE
 *   MIGRATE_ON_DEPLOY=false schaltet den Hook auf reines Anzeigen um. Der
 *   Deploy laeuft dann durch, ohne etwas an der Datenbank zu aendern.
 *
 * WARUM DIE ERKLAERUNG HIER STEHT UND NICHT IM PROCFILE
 *   Das Procfile-Format kennt offiziell keine Kommentarzeilen. Ein Parser, der
 *   sie nicht stillschweigend ueberliest, verwirft im schlimmsten Fall auch den
 *   `web:`-Prozess — die App waere weg, fuer einen Kommentar. Das Procfile
 *   bleibt deshalb auf zwei Zeilen; begruendet wird hier.
 * ════════════════════════════════════════════════════════════════════════════
 */

require("dotenv").config();
const { Client } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const BASELINE_FILE = path.join(MIGRATIONS_DIR, "APPLIED_BASELINE.txt");

const STATUS_ONLY = process.argv.includes("--status");
const AUTO_MODE = process.argv.includes("--auto");

/** Marker in den ersten Zeilen einer Datei: laeuft bei Inhaltsaenderung erneut. */
const REPEATABLE_MARKER = /^--\s*@repeatable\b/m;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Entscheidet, was laufen darf — ohne Datenbank und ohne Dateisystem.
 *
 * Diese Funktion IST die Sicherheitseigenschaft dieses Skripts: was in der
 * Baseline steht, kann hier nicht in `pending` landen, auch dann nicht, wenn
 * der Vermerk in `_migrations` fehlt. Deshalb steht sie getrennt und wird von
 * tests/migrate.plan.test.js geprueft — ein Refactoring, das die Regel
 * aufweicht, faellt dort auf und nicht erst auf der Produktionsdatenbank.
 *
 * @param {object}            a
 * @param {string[]}          a.files       alle .sql-Dateinamen, sortiert
 * @param {Set<string>}       a.baseline    von Hand eingespielter Altbestand
 * @param {Set<string>}       a.applied     was in `_migrations` vermerkt ist
 * @param {Map<string,string>} a.hashes     Datei → gespeicherter Inhalts-Hash
 * @param {(f:string)=>string} a.read       liefert den Inhalt einer Datei
 */
function plan({ files, baseline, applied, hashes, read }) {
  const repeatables = files.filter((f) => REPEATABLE_MARKER.test(read(f).slice(0, 2000)));
  const repeatableSet = new Set(repeatables);
  return {
    repeatables,
    // Nachzutragen: Altbestand ohne Vermerk. Wird VERMERKT, nie ausgefuehrt.
    baselineToRecord: [...baseline].filter((f) => !applied.has(f)).sort(),
    // Ausstehend: kein Altbestand, kein Vermerk, nicht wiederholbar.
    pending: files.filter(
      (f) => !baseline.has(f) && !applied.has(f) && !repeatableSet.has(f)
    ),
    // Faellig: wiederholbare Datei, deren Inhalt sich geaendert hat.
    repeatableTodo: repeatables.filter((f) => hashes.get(f) !== sha256(read(f))),
    // Baseline-Eintraege ohne Datei — Hinweis auf Umbenennung/Loeschung.
    baselineWithoutFile: [...baseline].filter((f) => !files.includes(f)),
  };
}

async function getClient() {
  const url = process.env.DATABASE_URL || process.env.SCALINGO_POSTGRESQL_URL;
  if (!url) {
    console.error(
      "❌  Kein Datenbankweg: weder DATABASE_URL noch SCALINGO_POSTGRESQL_URL gesetzt."
    );
    process.exit(1);
  }
  // Verlangt der Verbindungsstring TLS, akzeptieren wir die Kette ohne
  // Pruefung: die Zertifikate der verwalteten Datenbank haengen an einer CA,
  // die im Container nicht im Trust Store liegt. Die Verbindung laeuft im
  // privaten Netz des Anbieters. Ohne diese Zeile bricht der Hook mit
  // "self-signed certificate in certificate chain" ab.
  const needsTls = /sslmode=(require|verify-ca|verify-full)/.test(url);
  const client = new Client({
    connectionString: url,
    ...(needsTls ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  return client;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Woher der Vermerk kommt: 'baseline' = von Hand eingespielt und hier nur
  // nachgetragen, 'auto' = von diesem Runner ausgefuehrt. Ohne die Spalte
  // sieht man spaeter nicht mehr, was tatsaechlich gelaufen ist.
  await client.query(`ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS source TEXT`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations_repeatable (
      filename   TEXT PRIMARY KEY,
      sha256     TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getApplied(client) {
  const { rows } = await client.query(
    "SELECT filename FROM _migrations ORDER BY filename"
  );
  return new Set(rows.map((r) => r.filename));
}

async function getRepeatableHashes(client) {
  const { rows } = await client.query(
    "SELECT filename, sha256 FROM _migrations_repeatable"
  );
  return new Map(rows.map((r) => [r.filename, r.sha256]));
}

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Der von Hand eingespielte Altbestand. Fehlt die Datei, ist das ein Fehler
 *  und kein leeres Set: ohne sie wuerde der Runner alles als ausstehend
 *  ansehen — siehe Eigenschaft 1 im Kopfkommentar. */
function getBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(
      `❌  ${path.basename(BASELINE_FILE)} fehlt. Ohne diese Liste gilt der ` +
        `gesamte Altbestand als ausstehend — Abbruch, bevor Schaden entsteht.`
    );
    process.exit(1);
  }
  return new Set(
    fs
      .readFileSync(BASELINE_FILE, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
}

function readMigration(file) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

/** Fuehrt eine Datei in EINER Transaktion aus und vermerkt sie. */
async function applyFile(client, file, { repeatable }) {
  const sql = readMigration(file);
  process.stdout.write(`  ⏳  ${file}${repeatable ? "  (wiederholbar)" : ""}\n`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    if (repeatable) {
      await client.query(
        `INSERT INTO _migrations_repeatable (filename, sha256, applied_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (filename) DO UPDATE SET sha256 = $2, applied_at = NOW()`,
        [file, sha256(sql)]
      );
    } else {
      await client.query(
        `INSERT INTO _migrations (filename, source) VALUES ($1, 'auto')
         ON CONFLICT (filename) DO NOTHING`,
        [file]
      );
    }
    await client.query("COMMIT");
    console.log(`  ✅  ${file}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`  ❌  ${file} FEHLGESCHLAGEN:\n      ${err.message}`);
    throw err;
  }
}

/** Traegt den Altbestand als angewendet nach, OHNE ihn auszufuehren. */
async function recordBaseline(client, fehlende) {
  if (fehlende.length === 0) return 0;
  await client.query("BEGIN");
  try {
    for (const f of fehlende) {
      await client.query(
        `INSERT INTO _migrations (filename, source) VALUES ($1, 'baseline')
         ON CONFLICT (filename) DO NOTHING`,
        [f]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
  return fehlende.length;
}

async function main() {
  // Notbremse: nur in der Betriebsart des Hooks, damit ein manueller Aufruf
  // sich nicht unbemerkt verweigert.
  const abgeschaltet =
    AUTO_MODE && String(process.env.MIGRATE_ON_DEPLOY || "").toLowerCase() === "false";

  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const baseline = getBaseline();
    const files = getMigrationFiles();

    const applied = await getApplied(client);
    const hashes = await getRepeatableHashes(client);

    const { pending, repeatableTodo, baselineToRecord, baselineWithoutFile } = plan({
      files, baseline, applied, hashes, read: readMigration,
    });

    if (baselineWithoutFile.length) {
      console.warn(
        `⚠  ${baselineWithoutFile.length} Baseline-Eintrag/-Eintraege ohne Datei ` +
          `(umbenannt oder geloescht?): ${baselineWithoutFile.join(", ")}`
      );
    }

    if (STATUS_ONLY || abgeschaltet) {
      if (abgeschaltet) {
        console.log(
          "\n⏸  MIGRATE_ON_DEPLOY=false — es wird NICHTS eingespielt, nur berichtet.\n"
        );
      }
      console.log(`Dateien: ${files.length} · Altbestand (Baseline): ${baseline.size}`);
      console.log(`Bereits vermerkt: ${applied.size}`);
      console.log(
        `Ausstehend: ${pending.length}${pending.length ? " → " + pending.join(", ") : ""}`
      );
      console.log(
        `Wiederholbar faellig: ${repeatableTodo.length}` +
          `${repeatableTodo.length ? " → " + repeatableTodo.join(", ") : ""}`
      );
      console.log();
      return;
    }

    const nachgetragen = await recordBaseline(client, baselineToRecord);
    if (nachgetragen > 0) {
      console.log(
        `\n📎  ${nachgetragen} Datei(en) als von Hand eingespielt vermerkt — ` +
          `NICHT ausgefuehrt (APPLIED_BASELINE.txt).`
      );
    }

    if (pending.length === 0 && repeatableTodo.length === 0) {
      console.log("✅  Nichts einzuspielen.\n");
      return;
    }

    if (pending.length) {
      console.log(`\nSpiele ${pending.length} Migration(en) ein:\n`);
      for (const file of pending) await applyFile(client, file, { repeatable: false });
    }
    if (repeatableTodo.length) {
      console.log(
        `\nSpiele ${repeatableTodo.length} wiederholbare Datei(en) ein ` +
          `(Inhalt hat sich geaendert):\n`
      );
      for (const file of repeatableTodo) await applyFile(client, file, { repeatable: true });
    }
    console.log("\nFertig.\n");
  } finally {
    await client.end();
  }
}

// Die Planung ist als reine Funktion pruefbar (tests/migrate.plan.test.js).
module.exports = { plan, sha256, REPEATABLE_MARKER };

// Nur beim direkten Aufruf verbinden — ein `require()` im Test darf keine
// Datenbankverbindung aufbauen.
if (require.main === module) {
  main().catch((err) => {
    // Kein Schoenreden: Exit 1 laesst den Deploy scheitern, und die alte
    // Version bleibt online. Besser ein sichtbar gescheiterter Deploy als eine
    // Migration, von der niemand weiss, dass sie fehlt.
    console.error("\n❌  Migration abgebrochen:", err?.message || err);
    process.exit(1);
  });
}
