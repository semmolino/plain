#!/usr/bin/env node
/**
 * Migration runner for PlaIn backend.
 * Reads .sql files from backend/migrations/, tracks applied ones in the
 * _migrations table, and runs any that are pending.
 *
 * Usage:
 *   node scripts/migrate.js                      – apply pending migrations
 *   node scripts/migrate.js --status             – show applied / pending
 *   node scripts/migrate.js --only 0140,0141          – nur diese anwenden
 *   node scripts/migrate.js --backfill --through 0138 [--confirm]
 *
 * ABOUT --only: a pending migration is not always one you want to run right now.
 * 0070b_license_capabilities_seed.sql is regenerated from capabilities.manifest.js
 * and sits pending; applying it as a side effect of an unrelated change would
 * silently alter which permissions are gated in which tariff. --only takes
 * number prefixes or filename fragments and applies just those, in file order.
 *
 * ABOUT --backfill: records files that are already in the database WITHOUT
 * running them, so the runner does not start from the beginning on a database
 * that was migrated by hand. Production was backfilled this way on 2026-09-08
 * (152 rows, all within the same tenth of a second), so this is normally not
 * needed - it is here for a restored or rebuilt database.
 *
 * It is an assertion about the past, so it is deliberately awkward: --through
 * takes the highest number you know is applied, and nothing is written without
 * --confirm. Anything above that number stays pending. A file wrongly recorded
 * as applied never runs.
 *
 * Requires DATABASE_URL in backend/.env - the Scalingo database, reachable via
 * scripts/scalingo/04_db_tunnel.sh. (The old Supabase project is leftover and
 * holds outdated data; do not point this at it.)
 */

const path0 = require("path");
// Explicit path: without it the config depends on the working directory, and a
// run from the repo root would silently find no DATABASE_URL.
require("dotenv").config({ path: path0.join(__dirname, "..", ".env") });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const STATUS_ONLY = process.argv.includes("--status");
const BACKFILL = process.argv.includes("--backfill");
const CONFIRM = process.argv.includes("--confirm");
const THROUGH = (() => {
  const i = process.argv.indexOf("--through");
  return i !== -1 ? process.argv[i + 1] : null;
})();
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i === -1) return null;
  return String(process.argv[i + 1] || "").split(",").map((x) => x.trim()).filter(Boolean);
})();

/** Leading migration number, e.g. "0070b_seed.sql" -> 70. */
function migrationNumber(filename) {
  const m = /^(\d{4})/.exec(filename);
  return m ? parseInt(m[1], 10) : NaN;
}

async function getClient() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "❌  DATABASE_URL is not set in backend/.env\n" +
        "    Open the tunnel first: scripts/scalingo/04_db_tunnel.sh"
    );
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
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
}

async function getApplied(client) {
  const { rows } = await client.query(
    "SELECT filename FROM _migrations ORDER BY filename"
  );
  return new Set(rows.map((r) => r.filename));
}

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Record already-applied migrations without running them.
 *
 * The cutoff is required and has to be spelled out, because the failure mode is
 * silent and permanent in the other direction: a file marked as applied that was
 * never actually run will never run.
 */
async function backfill(client, applied, files) {
  if (!THROUGH) {
    console.error(
      "\n❌  --backfill needs --through <number>, e.g. --through 0138.\n" +
        "    That is the highest migration you know is already in the database.\n" +
        "    Everything above it stays pending and will be applied normally.\n"
    );
    process.exit(1);
  }
  const cutoff = parseInt(THROUGH, 10);
  if (Number.isNaN(cutoff)) {
    console.error(`\n❌  --through "${THROUGH}" is not a number.\n`);
    process.exit(1);
  }

  const candidates = files.filter(
    (f) => !applied.has(f) && migrationNumber(f) <= cutoff
  );
  const above = files.filter((f) => migrationNumber(f) > cutoff);

  if (candidates.length === 0) {
    console.log("\n✅  Nothing to backfill - every file up to the cutoff is already recorded.\n");
    return;
  }

  console.log(`\n${CONFIRM ? "Recording" : "Would record"} ${candidates.length} file(s) as applied, WITHOUT running them:\n`);
  for (const f of candidates) console.log(`  ${f}`);
  if (above.length) {
    console.log(`\n${above.length} file(s) stay pending (above ${THROUGH}):`);
    for (const f of above) console.log(`  ${f}`);
  }

  if (!CONFIRM) {
    console.log(
      "\n  Dry run. This asserts these migrations are already in the database.\n" +
        "  Check that before passing --confirm - a wrongly recorded file never runs.\n"
    );
    return;
  }

  await client.query("BEGIN");
  try {
    for (const f of candidates) {
      await client.query(
        "INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
        [f]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`\n❌  Backfill failed: ${err.message}\n`);
    process.exit(1);
  }
  console.log(`\n✅  ${candidates.length} file(s) recorded. Run --status to check.\n`);
}

async function main() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files = getMigrationFiles();

    if (BACKFILL) {
      await backfill(client, applied, files);
      return;
    }

    if (STATUS_ONLY) {
      console.log("\nMigration status:\n");
      for (const f of files) {
        const status = applied.has(f) ? "✅ applied" : "⏳ pending";
        console.log(`  ${status}  ${f}`);
      }
      console.log();
      return;
    }

    let pending = files.filter((f) => !applied.has(f));

    if (ONLY) {
      const wanted = pending.filter((f) => ONLY.some((o) => f.startsWith(o) || f.includes(o)));
      const unmatched = ONLY.filter((o) => !pending.some((f) => f.startsWith(o) || f.includes(o)));
      if (unmatched.length) {
        console.error(
          `\n❌  --only matched nothing pending for: ${unmatched.join(", ")}\n` +
            "    Either the file is already applied or the name is wrong (--status shows both).\n"
        );
        process.exit(1);
      }
      const skipped = pending.filter((f) => !wanted.includes(f));
      if (skipped.length) {
        console.log(`\nSkipping ${skipped.length} other pending migration(s):`);
        for (const f of skipped) console.log(`  ⏭  ${f}`);
      }
      pending = wanted;
    }

    if (pending.length === 0) {
      console.log("✅  No pending migrations.");
      return;
    }

    console.log(`\nRunning ${pending.length} pending migration(s)...\n`);
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`  ⏳  ${file}`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO _migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`  ✅  ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ❌  ${file} FAILED:\n     ${err.message}`);
        process.exit(1);
      }
    }
    console.log("\nAll migrations applied.\n");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
