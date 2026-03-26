#!/usr/bin/env node
/**
 * Migration runner for PlaIn backend.
 * Reads .sql files from backend/migrations/, tracks applied ones in the
 * _migrations table, and runs any that are pending.
 *
 * Usage:
 *   node scripts/migrate.js            – apply pending migrations
 *   node scripts/migrate.js --status   – show applied / pending migrations
 *
 * Requires DATABASE_URL in backend/.env (Supabase direct Postgres URL):
 *   postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
 */

require("dotenv").config();
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const STATUS_ONLY = process.argv.includes("--status");

async function getClient() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "❌  DATABASE_URL is not set in .env\n" +
        "    Add: DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"
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

async function main() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files = getMigrationFiles();

    if (STATUS_ONLY) {
      console.log("\nMigration status:\n");
      for (const f of files) {
        const status = applied.has(f) ? "✅ applied" : "⏳ pending";
        console.log(`  ${status}  ${f}`);
      }
      console.log();
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
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
