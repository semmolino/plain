#!/usr/bin/env node
/**
 * Rename tooling for the table/column renaming project.
 *
 * Everything is derived from rename-map.json so the SQL migration, the code
 * changes and the verification can never drift apart.
 *
 * Usage (run from anywhere):
 *   node backend/scripts/rename/rename.js check   [--block ID]
 *   node backend/scripts/rename/rename.js sql     [--block ID]
 *   node backend/scripts/rename/rename.js apply   [--block ID] [--write]
 *   node backend/scripts/rename/rename.js guard   [--block ID]
 *   node backend/scripts/rename/rename.js verify  [--block ID]
 *
 * check   - introspects the live DB: do the old names exist, is a column name
 *           ambiguous across tables, would a new name collide, and which
 *           plpgsql functions / views mention the old identifiers. Function
 *           bodies are plain text and are NOT updated by ALTER ... RENAME, so
 *           this list is the manual work the rename leaves behind.
 * sql     - writes the next numbered up-migration plus a matching down file.
 * apply   - the codemod. Dry-run unless --write is passed.
 * guard   - fails if any old identifier is still present in the code.
 * verify  - asserts the live DB matches the map (new there, old gone).
 *
 * Requires DATABASE_URL in backend/.env (same variable migrate.js uses).
 */

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..", "..");
require("dotenv").config({ path: path.join(REPO, "backend", ".env") });

const MAP_FILE = path.join(HERE, "rename-map.json");
const MIGRATIONS_DIR = path.join(REPO, "backend", "migrations");

/** Roots the codemod and the guard walk. */
const SCAN_ROOTS = ["backend", "frontend-react/src", "frontend-react/tests"];
const SCAN_EXT = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".njk", ".json"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "uploads",
  "android", "playwright-report", "test-results", ".vite",
  "migrations", // history is never rewritten
  "rename",     // this tool holds the old names on purpose
]);

const args = process.argv.slice(2);
const CMD = args[0];
const WRITE = args.includes("--write");
const BLOCK_FILTER = (() => {
  const i = args.indexOf("--block");
  return i !== -1 ? args[i + 1] : null;
})();

// ---------------------------------------------------------------- map loading

function loadBlocks() {
  const raw = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  let blocks = (raw.blocks || []).filter((b) => b.status === "planned");
  if (BLOCK_FILTER) blocks = blocks.filter((b) => b.id === BLOCK_FILTER);
  if (blocks.length === 0) {
    console.error(
      BLOCK_FILTER
        ? `No block "${BLOCK_FILTER}" with status "planned" in rename-map.json.`
        : 'No block with status "planned" in rename-map.json.'
    );
    process.exit(1);
  }
  for (const b of blocks) validateBlock(b);
  return blocks;
}

function validateBlock(block) {
  const seen = new Map();
  for (const t of block.tables || []) {
    if (!t.from) fail(`Block ${block.id}: a table entry has no "from".`);
    for (const c of t.columns || []) {
      if (!c.from || !c.to) fail(`Block ${block.id}: ${t.from} has a column entry without from/to.`);
      if (!["global", "table"].includes(c.scope || "")) {
        fail(`Block ${block.id}: ${t.from}.${c.from} needs "scope": "global" or "table".`);
      }
      // The same identifier must not be renamed to two different targets.
      if (c.scope === "global") {
        const prev = seen.get(c.from);
        if (prev && prev !== c.to) {
          fail(`Block ${block.id}: "${c.from}" is mapped to both "${prev}" and "${c.to}" as scope "global".`);
        }
        seen.set(c.from, c.to);
      }
    }
  }
}

function fail(msg) {
  console.error(`\n  ERROR  ${msg}\n`);
  process.exit(1);
}

/** All identifier replacements a codemod may safely apply repo-wide. */
function globalReplacements(blocks) {
  const map = new Map();
  const add = (from, to, what) => {
    if (map.has(from) && map.get(from).to !== to) {
      fail(`"${from}" is mapped to both "${map.get(from).to}" and "${to}".`);
    }
    map.set(from, { to, what });
  };
  for (const b of blocks) {
    for (const t of b.tables || []) {
      if (t.to) add(t.from, t.to, `table ${t.from}`);
      for (const c of t.columns || []) {
        if (c.scope === "global") add(c.from, c.to, `${t.from}.${c.from}`);
      }
    }
  }
  return map;
}

/** Column renames that a repo-wide replace would corrupt. */
function manualColumns(blocks) {
  const out = [];
  for (const b of blocks) {
    for (const t of b.tables || []) {
      for (const c of t.columns || []) {
        if (c.scope === "table") out.push({ block: b.id, table: t.from, ...c });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- file traversal

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      yield full;
    }
  }
}

function* sourceFiles() {
  for (const root of SCAN_ROOTS) yield* walk(path.join(REPO, root));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/**
 * One alternation over all tokens, longest first, replaced in a single pass so
 * a chain (A->B, B->C) cannot cascade into A->C.
 */
function buildRegex(tokens) {
  const sorted = [...tokens].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`\\b(${sorted.join("|")})\\b`, "g");
}

// --------------------------------------------------------------------- db

async function withDb(fn) {
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is not set in backend/.env - needed for check/verify.");
  }
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function tablesWithColumn(client, column) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = $1
      ORDER BY table_name`,
    [column]
  );
  return rows.map((r) => r.table_name);
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

/** Functions and views whose *body text* mentions an identifier. */
async function dbObjectsReferencing(client, identifier) {
  const { rows } = await client.query(
    `SELECT p.proname AS name, 'function' AS kind
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosrc ILIKE '%' || $1 || '%'
      UNION ALL
     SELECT c.relname AS name,
            CASE c.relkind WHEN 'v' THEN 'view' ELSE 'matview' END AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
        AND pg_get_viewdef(c.oid) ILIKE '%' || $1 || '%'
      ORDER BY kind, name`,
    [identifier]
  );
  return rows;
}

// ------------------------------------------------------------------ commands

async function cmdCheck(blocks) {
  await withDb(async (client) => {
    let problems = 0;
    const dbRefs = new Map();

    for (const b of blocks) {
      console.log(`\n=== block ${b.id} ===`);
      for (const t of b.tables || []) {
        if (!(await tableExists(client, t.from))) {
          console.log(`  MISSING  table "${t.from}" does not exist in the DB`);
          problems++;
          continue;
        }
        if (t.to) {
          if (await tableExists(client, t.to)) {
            console.log(`  COLLISION  target table "${t.to}" already exists`);
            problems++;
          } else {
            console.log(`  ok  ${t.from} -> ${t.to}`);
          }
        }

        for (const c of t.columns || []) {
          const carriers = await tablesWithColumn(client, c.from);
          if (!carriers.includes(t.from)) {
            console.log(`  MISSING  ${t.from}."${c.from}" does not exist`);
            problems++;
            continue;
          }
          const others = carriers.filter((x) => x !== t.from);
          const target = await tablesWithColumn(client, c.to);
          if (target.includes(t.from)) {
            console.log(`  COLLISION  ${t.from}."${c.to}" already exists`);
            problems++;
          }
          if (c.scope === "global" && others.length) {
            console.log(
              `  UNSAFE  ${t.from}."${c.from}" is marked "global" but the same ` +
                `column name exists on: ${others.join(", ")}\n` +
                `          -> a repo-wide replace would corrupt those. Use "scope": "table".`
            );
            problems++;
          } else if (c.scope === "table" && !others.length) {
            console.log(
              `  hint  ${t.from}."${c.from}" is unique in the schema - ` +
                `"scope": "global" would let the codemod handle it automatically`
            );
          } else {
            console.log(`  ok  ${t.from}.${c.from} -> ${c.to} (${c.scope})`);
          }
        }
      }
    }

    // ALTER ... RENAME does not touch plpgsql bodies. Collect the fallout.
    for (const [ident] of globalReplacements(blocks)) {
      const refs = await dbObjectsReferencing(client, ident);
      for (const r of refs) {
        const key = `${r.kind}:${r.name}`;
        if (!dbRefs.has(key)) dbRefs.set(key, new Set());
        dbRefs.get(key).add(ident);
      }
    }
    for (const m of manualColumns(blocks)) {
      const refs = await dbObjectsReferencing(client, m.from);
      for (const r of refs) {
        const key = `${r.kind}:${r.name}`;
        if (!dbRefs.has(key)) dbRefs.set(key, new Set());
        dbRefs.get(key).add(`${m.table}.${m.from}`);
      }
    }

    console.log(`\n=== DB objects to rewrite by hand ===`);
    if (dbRefs.size === 0) {
      console.log("  none");
    } else {
      console.log("  Views follow a rename automatically but keep their old output");
      console.log("  column names. Function bodies are plain text and break at call time.\n");
      for (const [key, idents] of [...dbRefs].sort()) {
        console.log(`  ${key}  <- ${[...idents].join(", ")}`);
      }
    }

    console.log(
      problems === 0
        ? "\nCheck passed.\n"
        : `\nCheck found ${problems} problem(s) - fix rename-map.json before generating SQL.\n`
    );
    if (problems) process.exitCode = 1;
  });
}

function nextMigrationNumber() {
  const nums = fs
    .readdirSync(MIGRATIONS_DIR)
    .map((f) => /^(\d{4})_/.exec(f))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  return String(Math.max(0, ...nums) + 1).padStart(4, "0");
}

function cmdSql(blocks) {
  const num = nextMigrationNumber();
  const slug = blocks.length === 1 ? blocks[0].id.replace(/[^a-z0-9]+/gi, "_") : "rename_block";
  const upLines = [];
  const downLines = [];

  for (const b of blocks) {
    upLines.push(`-- block ${b.id}`);
    downLines.push(`-- block ${b.id}`);
    for (const t of b.tables || []) {
      // Columns first, while the table still has its old name.
      for (const c of t.columns || []) {
        upLines.push(`ALTER TABLE "${t.from}" RENAME COLUMN "${c.from}" TO "${c.to}";`);
      }
      if (t.to) upLines.push(`ALTER TABLE "${t.from}" RENAME TO "${t.to}";`);

      // Down: table name back first, then the columns.
      if (t.to) downLines.push(`ALTER TABLE "${t.to}" RENAME TO "${t.from}";`);
      for (const c of t.columns || []) {
        downLines.push(`ALTER TABLE "${t.from}" RENAME COLUMN "${c.to}" TO "${c.from}";`);
      }
    }
  }

  const header = (dir) =>
    `-- ${num}_${slug}${dir === "down" ? "_DOWN" : ""}.sql\n` +
    `-- Generated by backend/scripts/rename/rename.js - do not hand-edit.\n` +
    `-- Source of truth: backend/scripts/rename/rename-map.json\n` +
    `-- migrate.js wraps this file in a transaction; a failure rolls the whole file back.\n\n`;

  const upFile = path.join(MIGRATIONS_DIR, `${num}_${slug}.sql`);
  const downFile = path.join(HERE, `${num}_${slug}_DOWN.sql`);

  fs.writeFileSync(upFile, header("up") + upLines.join("\n") + "\n");
  fs.writeFileSync(
    downFile,
    header("down") +
      "-- Not a migration. Paste into the SQL editor to undo the block.\n\n" +
      downLines.join("\n") + "\n"
  );

  console.log(`\n  wrote  ${path.relative(REPO, upFile)}`);
  console.log(`  wrote  ${path.relative(REPO, downFile)}   (rollback, not tracked by migrate.js)`);
  console.log(`\n  Reminder: plpgsql functions are NOT covered - run "check" and rewrite them.\n`);
}

function cmdApply(blocks) {
  const repl = globalReplacements(blocks);
  const manual = manualColumns(blocks);

  if (repl.size === 0) {
    console.log("\n  Nothing marked scope \"global\" - the codemod has nothing to do.\n");
  } else {
    const re = buildRegex([...repl.keys()]);
    let changedFiles = 0;
    let totalHits = 0;

    for (const file of sourceFiles()) {
      const before = fs.readFileSync(file, "utf8");
      let hits = 0;
      const after = before.replace(re, (m) => {
        hits++;
        return repl.get(m).to;
      });
      if (!hits) continue;
      changedFiles++;
      totalHits += hits;
      console.log(`  ${WRITE ? "wrote" : "would change"}  ${path.relative(REPO, file)}  (${hits})`);
      if (WRITE) fs.writeFileSync(file, after);
    }

    console.log(
      `\n  ${totalHits} occurrence(s) in ${changedFiles} file(s)` +
        (WRITE ? " rewritten.\n" : " - dry run, pass --write to apply.\n")
    );
  }

  if (manual.length) {
    console.log("=== manual review required (scope: \"table\") ===");
    console.log("  These column names also exist on tables that are not being renamed,");
    console.log("  so each occurrence has to be judged by which table it queries.\n");
    for (const m of manual) {
      const re = buildRegex([m.from]);
      const found = [];
      for (const file of sourceFiles()) {
        const text = fs.readFileSync(file, "utf8");
        text.split("\n").forEach((line, i) => {
          if (re.test(line)) found.push(`${path.relative(REPO, file)}:${i + 1}`);
          re.lastIndex = 0;
        });
      }
      console.log(`  ${m.table}.${m.from} -> ${m.to}   (${found.length} occurrence(s))`);
      for (const f of found) console.log(`      ${f}`);
      console.log();
    }
  }
}

function cmdGuard(blocks) {
  const tokens = new Map();
  for (const [from, info] of globalReplacements(blocks)) tokens.set(from, info.what);
  for (const m of manualColumns(blocks)) tokens.set(m.from, `${m.table}.${m.from}`);

  const re = buildRegex([...tokens.keys()]);
  const leftovers = [];

  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        leftovers.push({ file: path.relative(REPO, file), line: i + 1, token: m[1] });
      }
    });
  }

  if (leftovers.length === 0) {
    console.log("\n  Guard clean - no old identifier left in the scanned code.\n");
    return;
  }
  console.log(`\n  ${leftovers.length} leftover occurrence(s):\n`);
  for (const l of leftovers) console.log(`  ${l.file}:${l.line}   ${l.token}`);
  console.log(
    "\n  Note: backend/migrations/ and docs/ are deliberately not scanned -" +
      "\n  migration history stays as written.\n"
  );
  process.exitCode = 1;
}

async function cmdVerify(blocks) {
  await withDb(async (client) => {
    let bad = 0;
    for (const b of blocks) {
      for (const t of b.tables || []) {
        const live = t.to || t.from;
        if (t.to) {
          if (await tableExists(client, t.from)) { console.log(`  FAIL  old table "${t.from}" still exists`); bad++; }
          if (!(await tableExists(client, t.to))) { console.log(`  FAIL  new table "${t.to}" missing`); bad++; }
        }
        for (const c of t.columns || []) {
          const carriers = await tablesWithColumn(client, c.to);
          if (!carriers.includes(live)) { console.log(`  FAIL  ${live}."${c.to}" missing`); bad++; }
          const oldCarriers = await tablesWithColumn(client, c.from);
          if (oldCarriers.includes(live)) { console.log(`  FAIL  ${live}."${c.from}" still exists`); bad++; }
        }
      }
    }
    console.log(bad === 0 ? "\n  DB matches the map.\n" : `\n  ${bad} mismatch(es).\n`);
    if (bad) process.exitCode = 1;
  });
}

// ---------------------------------------------------------------------- main

async function main() {
  const commands = { check: cmdCheck, sql: cmdSql, apply: cmdApply, guard: cmdGuard, verify: cmdVerify };
  const fn = commands[CMD];
  if (!fn) {
    console.log("\nUsage: node backend/scripts/rename/rename.js <check|sql|apply|guard|verify> [--block ID] [--write]\n");
    process.exit(1);
  }
  await fn(loadBlocks());
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
