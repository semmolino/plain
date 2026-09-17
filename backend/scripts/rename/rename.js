#!/usr/bin/env node
/**
 * Rename tooling for the table/column renaming project.
 *
 * Everything is derived from rename-map.json so the SQL migration, the code
 * changes and the verification can never drift apart.
 *
 * Usage (run from anywhere):
 *   node backend/scripts/rename/rename.js check   [--block ID]
 *   node backend/scripts/rename/rename.js sql       [--block ID]
 *   node backend/scripts/rename/rename.js functions [--block ID]
 *   node backend/scripts/rename/rename.js apply   [--block ID] [--write]
 *   node backend/scripts/rename/rename.js guard   [--block ID]
 *   node backend/scripts/rename/rename.js verify  [--block ID]
 *
 * check   - introspects the live DB across ALL application schemas, not just
 *           public: do the old names exist, is a column name ambiguous across
 *           tables, would a new name collide, and which plpgsql functions /
 *           views mention the old identifiers. Function bodies are plain text
 *           and are NOT updated by ALTER ... RENAME, so that list is the manual
 *           work the rename leaves behind. Also lists identifiers the code
 *           assembles at runtime, which no search can rewrite.
 * sql     - writes the next numbered up-migration plus a matching down file,
 *           each ending in NOTIFY pgrst so PostgREST drops its schema cache.
 * functions - the other half of the rename, which ALTER does not do: plpgsql
 *           bodies and the output column names of views. Reads the live
 *           definitions, applies the same replacement and writes a second
 *           migration. Run it AFTER "sql", so the numbering follows.
 * apply   - the codemod. Dry-run unless --write is passed; --write without
 *           --block is refused, because blocks are meant to land one at a time.
 * guard   - fails if any old identifier is still present in the code.
 * verify  - asserts the live DB matches the map (new there, old gone) AND that
 *           no function or view body still carries an old name.
 *
 * Neither the tests nor tsc can catch a rename mistake - see smoke.mjs next to
 * this file for the one check that actually puts code and database together.
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

/**
 * Roots the codemod and the guard walk.
 *
 * owner-console is a second Express app on the same database - it carries its
 * own .from(...) calls and would silently keep the old names if it were left
 * out here.
 */
const SCAN_ROOTS = [
  "backend",
  "frontend-react/src",
  "frontend-react/tests",
  "owner-console",
];
const SCAN_EXT = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".njk", ".json"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "uploads",
  "android", "playwright-report", "test-results", ".vite",
  "migrations", // history is never rewritten
  "sql",        // backend/sql holds the superseded originals of early migrations
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

/** Extra identifier prefixes the map asks the guard to watch. */
let EXTRA_DYNAMIC_WATCH = [];
/** Files that assemble column names from variables - no search can cover them. */
let ALWAYS_REVIEW = [];

function loadBlocks() {
  const raw = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  EXTRA_DYNAMIC_WATCH = raw.dynamicWatch || [];
  ALWAYS_REVIEW = raw.alwaysReview || [];
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

/**
 * Lowercase words that also occur as ordinary identifiers throughout the code.
 * Deriving the request-field twin from them automatically would be reckless, so
 * the author has to spell it out after looking at the call sites.
 */
const RISKY_API_TOKENS = new Set([
  "id", "name", "date", "type", "value", "status", "role", "position",
  "category", "abbr", "scope", "key", "label", "code", "order", "group",
  "level", "state", "title", "amount", "total", "rate", "count", "index",
  "data", "text", "time", "year", "month", "start", "end",
]);

/**
 * The snake_case twin of an identifier, the way it appears in request bodies.
 * Returns null when the entry does not opt in via "api".
 */
function apiTwin(entry) {
  if (!entry || entry.api === undefined || entry.api === false) return null;
  if (entry.api === true) {
    return entry.to
      ? { from: entry.from.toLowerCase(), to: entry.to.toLowerCase() }
      : null;
  }
  if (typeof entry.api === "object" && entry.api.from && entry.api.to) {
    return { from: entry.api.from, to: entry.api.to };
  }
  return null;
}

function validateApi(block, what, entry) {
  if (entry.api === undefined || entry.api === false) return;
  if (entry.api === true) {
    if (!entry.to) fail(`Block ${block.id}: ${what} has "api": true but no "to".`);
    const from = entry.from.toLowerCase();
    const to = entry.to.toLowerCase();
    if (RISKY_API_TOKENS.has(from) || RISKY_API_TOKENS.has(to)) {
      fail(
        `Block ${block.id}: ${what} would derive the request-field rename ` +
          `"${from}" -> "${to}".\n` +
          `          One of those is an everyday word: as a source it would match ` +
          `unrelated code,\n          as a target it can collide with a local ` +
          `variable already called that. So it is\n          not derived ` +
          `automatically - run "apply" without --write, read the call sites, then\n` +
          `          spell it out as "api": { "from": "…", "to": "…" } - or set ` +
          `"api": false.`
      );
    }
    return;
  }
  if (typeof entry.api === "object" && entry.api !== null) {
    if (!entry.api.from || !entry.api.to) {
      fail(`Block ${block.id}: ${what} has an "api" entry without from/to.`);
    }
    return;
  }
  fail(`Block ${block.id}: ${what} has an invalid "api" - use true, false or { from, to }.`);
}

function validateBlock(block) {
  for (const d of block.derived || []) {
    if (!d.from || !d.to) fail(`Block ${block.id}: ein "derived"-Eintrag hat kein from/to.`);
  }
  const seen = new Map();
  for (const t of block.tables || []) {
    if (!t.from) fail(`Block ${block.id}: a table entry has no "from".`);
    validateApi(block, `table ${t.from}`, t);
    for (const c of t.columns || []) {
      if (!c.from || !c.to) fail(`Block ${block.id}: ${t.from} has a column entry without from/to.`);
      if (!["global", "table"].includes(c.scope || "")) {
        fail(`Block ${block.id}: ${t.from}.${c.from} needs "scope": "global" or "table".`);
      }
      validateApi(block, `${t.from}.${c.from}`, c);
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
  const add = (from, to, what, api = false) => {
    if (map.has(from) && map.get(from).to !== to) {
      fail(`"${from}" is mapped to both "${map.get(from).to}" and "${to}".`);
    }
    map.set(from, { to, what, api });
  };
  for (const b of blocks) {
    // Abgeleitete Namen: Ausgabespalten von Views und RETURNS TABLE, die es als
    // Tabellenspalte nirgends gibt. PARTIAL_PAYMENT_NET_TOTAL etwa entsteht in
    // fn_project_report_header als Summe und geht von dort in die API. ALTER
    // fasst so etwas nicht an - "functions" schreibt es mit um, und guard und
    // verify achten darauf, dass der Altname verschwindet. In "check" und "sql"
    // haben sie nichts zu suchen: es gibt keine Tabelle, die man altern koennte.
    for (const d of b.derived || []) {
      add(d.from, d.to, `derived ${d.from}`);
    }
    for (const t of b.tables || []) {
      if (t.to) add(t.from, t.to, `table ${t.from}`);
      const tTwin = apiTwin(t);
      if (tTwin) add(tTwin.from, tTwin.to, `table ${t.from} (request field)`, true);
      for (const c of t.columns || []) {
        // A "table"-scoped column is ambiguous, and so is its request field.
        if (c.scope !== "global") continue;
        add(c.from, c.to, `${t.from}.${c.from}`);
        const cTwin = apiTwin(c);
        if (cTwin) add(cTwin.from, cTwin.to, `${t.from}.${c.from} (request field)`, true);
      }
    }
  }
  return map;
}

/**
 * Identifier prefixes that the code may assemble at runtime, e.g.
 * `SURCHARGE_${i}_LABEL`. A word-boundary replace never sees those, and neither
 * does the guard - the token is not in the file. Derived from every affected
 * identifier plus whatever the map lists under "dynamicWatch".
 */
function dynamicPrefixes(blocks, extra = []) {
  const prefixes = new Set(extra);
  const consider = (ident) => {
    const parts = ident.split("_");
    // Every leading segment is a candidate: SURCHARGE_1_LABEL -> SURCHARGE_, SURCHARGE_1_
    for (let i = 1; i < parts.length; i++) {
      prefixes.add(parts.slice(0, i).join("_") + "_");
    }
  };
  for (const b of blocks) {
    for (const t of b.tables || []) {
      consider(t.from);
      for (const c of t.columns || []) consider(c.from);
    }
  }
  return [...prefixes].filter((p) => p.length > 3);
}

/**
 * Call sites where an identifier is cut in half by an interpolation or a
 * concatenation - `SURCHARGE_${i}_LABEL`, 'ZONE_' + n. The prefix has to sit
 * directly against the seam; merely mentioning it somewhere on a line that also
 * interpolates is what the first version matched, and it drowned the real hits.
 *
 * A name assembled entirely from a variable has no prefix to find at all. Those
 * files are listed under "alwaysReview" in the map instead.
 */
function findDynamicSites(prefixes) {
  if (prefixes.length === 0) return [];
  const alt = prefixes.map(escapeRe).join("|");
  const seam = new RegExp(`(${alt})(?:\\$\\{|['"\`]\\s*\\+)`);
  const hits = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      const m = seam.exec(line);
      if (m) hits.push({ file: path.relative(REPO, file), line: i + 1, prefix: m[1], text: line.trim().slice(0, 100) });
    });
  }
  return hits;
}

/**
 * "TABLE.COLUMN" -> new name, for every global column rename in this run.
 *
 * A second table carrying the same column name is only a problem if it KEEPS
 * that name. If this run renames it too, and to the same target, a repo-wide
 * replace is exactly right - that is the "or you are renaming it on all of
 * them" case the map documents.
 */
function globalColumnTargets(blocks) {
  const m = new Map();
  for (const b of blocks) {
    for (const t of b.tables || []) {
      for (const c of t.columns || []) {
        if (c.scope === "global") m.set(`${t.from}.${c.from}`, c.to);
      }
    }
  }
  return m;
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


// ------------------------------------------------- SQL objects (functions/views)

/**
 * ALTER ... RENAME moves a table, its indexes, constraints and policies, because
 * Postgres tracks those by OID. It does NOT touch two things:
 *
 *   - plpgsql bodies, which are plain text. They keep the old name and break
 *     when someone calls them, not when the rename runs.
 *   - the OUTPUT column names of views and of RETURNS TABLE signatures. Those
 *     keep pointing at the old spelling, so the API keeps serving the old key
 *     while the table underneath already carries the new one.
 *
 * Both are the same mechanical replacement the codemod does to the JS. Doing it
 * by hand would mean rewriting fn_project_report_header - 250 lines of plpgsql -
 * once per block in seven of the eight blocks. So it is generated here instead,
 * as a separate file that still gets read before it is applied.
 */

/** Views and matviews that depend on the given ones, transitively. */
async function dependentViews(client, oids) {
  if (oids.length === 0) return [];
  const { rows } = await client.query(
    `WITH RECURSIVE dep AS (
       SELECT c.oid, 0 AS lvl
         FROM pg_class c
        WHERE c.oid = ANY($1::oid[])
       UNION ALL
       SELECT c2.oid, dep.lvl + 1
         FROM dep
         JOIN pg_depend d  ON d.refobjid = dep.oid
         JOIN pg_rewrite r ON r.oid = d.objid
         JOIN pg_class c2  ON c2.oid = r.ev_class
        WHERE c2.relkind IN ('v', 'm') AND c2.oid <> dep.oid AND dep.lvl < 20
     )
     SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
            max(dep.lvl) AS lvl, pg_get_viewdef(c.oid, true) AS def
       FROM dep
       JOIN pg_class c ON c.oid = dep.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('v', 'm')
      GROUP BY n.nspname, c.relname, c.relkind, c.oid
      ORDER BY lvl`,
    [oids]
  );
  return rows;
}

async function affectedSqlObjects(client, blocks) {
  const idents = [];
  for (const [ident, info] of globalReplacements(blocks)) {
    if (!info.api) idents.push(ident); // request fields never appear in SQL
  }
  for (const m of manualColumns(blocks)) idents.push(m.from);

  const fns = new Map();
  const viewOids = new Set();
  for (const ident of idents) {
    const { rows } = await client.query(
      `SELECT n.nspname AS schema, p.proname AS name, p.oid,
              pg_get_functiondef(p.oid) AS def,
              pg_get_function_result(p.oid) AS result,
              pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${APP_SCHEMAS} AND p.prokind = 'f'
          AND (p.prosrc ILIKE '%' || $1 || '%' OR pg_get_function_result(p.oid) ILIKE '%' || $1 || '%')`,
      [ident]
    );
    for (const r of rows) fns.set(`${r.schema}.${r.name}`, r);

    const { rows: vrows } = await client.query(
      `SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${APP_SCHEMAS} AND c.relkind IN ('v','m')
          AND pg_get_viewdef(c.oid) ILIKE '%' || $1 || '%'`,
      [ident]
    );
    for (const r of vrows) viewOids.add(r.oid);
  }

  // Everything that reads an affected view has to come down with it and go back
  // up afterwards - a DROP ... CASCADE would remove it without rebuilding it.
  const views = await dependentViews(client, [...viewOids]);
  return { fns: [...fns.values()], views };
}

async function cmdFunctions(blocks) {
  await withDb(async (client) => {
    const { fns, views } = await affectedSqlObjects(client, blocks);
    if (fns.length === 0 && views.length === 0) {
      console.log("\n  No function or view mentions an affected identifier.\n");
      return;
    }

    const repl = globalReplacements(blocks);
    const tokens = [...repl.keys()].filter((k) => !repl.get(k).api);
    for (const m of manualColumns(blocks)) tokens.push(m.from);
    const re = buildRegex(tokens);
    const rewrite = (sql) => sql.replace(re, (t) => (repl.get(t) ? repl.get(t).to : t));

    const qname = (o) => `"${o.schema}"."${o.name}"`;
    const out = [];
    const touched = [];

    out.push(
      `-- Generated by backend/scripts/rename/rename.js functions - READ BEFORE APPLYING.`,
      `-- Source of truth: backend/scripts/rename/rename-map.json`,
      `--`,
      `-- ALTER ... RENAME leaves plpgsql bodies and view output columns alone. This`,
      `-- file is that leftover, with the same replacement applied that the codemod`,
      `-- applied to the JS. It is generated, not authored - but it is NOT automatic:`,
      `--`,
      `--   * a "table"-scoped identifier was replaced everywhere it appeared here.`,
      `--     If a body also reads a table that keeps the old column, that line is`,
      `--     now wrong. Check each one.`,
      `--   * CREATE VIEW loses an explicit column list, if the original had one.`,
      `--   * apply this AFTER the ALTER migration, in the same deploy.`,
      ``,
      `-- Funktionen koennen einander aufrufen. Ohne das hier haengt es an der`,
      `-- Reihenfolge, in der sie hier stehen.`,
      `SET check_function_bodies = false;`,
      ``
    );

    if (views.length) {
      out.push(`-- Views, most dependent first. They come down so their output column`);
      out.push(`-- names can change - CREATE OR REPLACE VIEW cannot rename a column.`);
      for (const v of [...views].sort((a, b) => b.lvl - a.lvl)) {
        out.push(`DROP ${v.kind === "m" ? "MATERIALIZED " : ""}VIEW IF EXISTS ${qname(v)};`);
        touched.push(`${v.kind === "m" ? "matview" : "view"} ${v.schema}.${v.name}`);
      }
      out.push(``);
    }

    if (fns.length) {
      // CREATE OR REPLACE kann den Rumpf aendern, aber KEINE Ausgabespalte
      // umbenennen - Postgres wertet das als geaenderten Rueckgabetyp und
      // bricht ab ("cannot change return type of existing function"). Wo die
      // Signatur betroffen ist, muss die Funktion also fallen und neu
      // entstehen; wo nur der Rumpf betroffen ist, bleibt CREATE OR REPLACE,
      // damit die Funktion ihre OID und damit ihre Rechte behaelt.
      const signaturBetroffen = (f) => f.result && rewrite(f.result) !== f.result;
      const zuDroppen = fns.filter(signaturBetroffen);

      if (zuDroppen.length) {
        out.push(`-- Diese Funktionen aendern ihre Ausgabespalten - CREATE OR REPLACE`);
        out.push(`-- kann das nicht, sie muessen fallen und neu entstehen.`);
        for (const f of zuDroppen) {
          out.push(`DROP FUNCTION IF EXISTS ${qname(f)}(${f.args || ""});`);
        }
        out.push(``);
      }

      out.push(`-- Funktionen. Wo die Signatur gleich bleibt, haelt CREATE OR REPLACE`);
      out.push(`-- die OID und damit die Rechte.`);
      for (const f of fns.sort((a, b) => a.name.localeCompare(b.name))) {
        // Nach einem DROP waere "OR REPLACE" harmlos, aber irrefuehrend.
        const def = signaturBetroffen(f)
          ? rewrite(f.def).replace(/^CREATE OR REPLACE FUNCTION/, "CREATE FUNCTION")
          : rewrite(f.def);
        out.push(def.trimEnd().replace(/;?$/, ";"), ``);
        touched.push(`function ${f.schema}.${f.name}${signaturBetroffen(f) ? " (neu angelegt)" : ""}`);
      }
    }

    if (views.length) {
      out.push(`-- Views back up, least dependent first.`);
      for (const v of [...views].sort((a, b) => a.lvl - b.lvl)) {
        const kind = v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW";
        out.push(`CREATE ${kind} ${qname(v)} AS`, rewrite(v.def).trimEnd().replace(/;?$/, ";"), ``);
      }
    }

    out.push(`-- PostgREST serves from a cached schema; without this it keeps using the old one.`);
    out.push(`NOTIFY pgrst, 'reload schema';`);

    const num = nextMigrationNumber();
    const slug = blocks.length === 1 ? blocks[0].id.replace(/[^a-z0-9]+/gi, "_") : "rename_block";
    const file = path.join(MIGRATIONS_DIR, `${num}_${slug}_sql_objects.sql`);
    fs.writeFileSync(file, out.join("\n") + "\n");

    console.log(`\n  wrote  ${path.relative(REPO, file)}`);
    console.log(`\n  ${touched.length} object(s) rebuilt:`);
    for (const t of touched) console.log(`    ${t}`);
    console.log(
      `\n  Read it before applying. A generated rewrite of a 250-line plpgsql body` +
      `\n  is still a rewrite of a 250-line plpgsql body.\n`
    );
  });
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
    fail(
      "DATABASE_URL is not set in backend/.env - needed for check, functions " +
      "and verify. Open the tunnel first: scripts/scalingo/04_db_tunnel.sh"
    );
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

/**
 * Every schema the application owns. Hardcoding 'public' would hide the
 * REPORTING schema, whose views and functions are called from public and are
 * not covered by the repo's schema dump.
 */
const APP_SCHEMAS = `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`;

/** "TABLE" in public, "SCHEMA.TABLE" anywhere else - public is the common case. */
const qual = (r) => (r.schema === "public" ? r.table : `${r.schema}.${r.table}`);

async function tablesWithColumn(client, column) {
  // relkind 'r'/'p' only: information_schema.columns also lists view columns,
  // and a view column is not something ALTER ... RENAME can touch - it follows
  // the view definition. Counting them made every NAME_SHORT carrier look
  // ambiguous against the VW_REPORT_* views.
  const { rows } = await client.query(
    `SELECT c.table_schema AS schema, c.table_name AS table
       FROM information_schema.columns c
       JOIN pg_namespace n ON n.nspname = c.table_schema
       JOIN pg_class k ON k.relname = c.table_name
                      AND k.relnamespace = n.oid
                      AND k.relkind IN ('r', 'p')
      WHERE ${APP_SCHEMAS} AND c.column_name = $1
      ORDER BY c.table_schema, c.table_name`,
    [column]
  );
  return rows;
}

/** The schemas that carry a table of this name - usually zero or one. */
async function tableSchemas(client, table) {
  const { rows } = await client.query(
    `SELECT t.table_schema AS schema, t.table_name AS table
       FROM information_schema.tables t
       JOIN pg_namespace n ON n.nspname = t.table_schema
      WHERE ${APP_SCHEMAS} AND t.table_name = $1
      ORDER BY t.table_schema`,
    [table]
  );
  return rows;
}

const tableExists = async (client, table) => (await tableSchemas(client, table)).length > 0;

/**
 * Functions and views whose *body text* mentions an identifier.
 *
 * Word boundaries, not a substring match. PARTIAL_PAYMENT_NET_TOTAL is an
 * output column of the report functions - a computed field, not a table
 * column, and deliberately not renamed. A LIKE '%...%' flagged every report
 * function over it and buried the real findings.
 */
async function dbObjectsReferencing(client, identifier) {
  const { rows } = await client.query(
    `SELECT n.nspname AS schema, p.proname AS name, 'function' AS kind
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${APP_SCHEMAS}
        -- Auch die RETURNS-TABLE-Signatur: die oeffentliche
        -- FN_REPORT_PROJECT_DETAIL reicht nur durch, deklariert die
        -- Ausgabespalten aber selbst. Nur den Rumpf zu pruefen haette sie
        -- uebersehen und verify waere gruen geblieben.
        AND (p.prosrc ~ ('\\m' || $1 || '\\M')
          OR pg_get_function_result(p.oid) ~ ('\\m' || $1 || '\\M'))
      UNION ALL
     SELECT n.nspname AS schema, c.relname AS name,
            CASE c.relkind WHEN 'v' THEN 'view' ELSE 'matview' END AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${APP_SCHEMAS} AND c.relkind IN ('v', 'm')
        AND pg_get_viewdef(c.oid) ~ ('\\m' || $1 || '\\M')
      ORDER BY kind, schema, name`,
    [identifier]
  );
  return rows;
}

// ------------------------------------------------------------------ commands

async function cmdCheck(blocks) {
  await withDb(async (client) => {
    let problems = 0;
    const dbRefs = new Map();
    const covered = globalColumnTargets(blocks);

    for (const b of blocks) {
      console.log(`\n=== block ${b.id} ===`);
      for (const d of b.derived || []) {
        // Kein Katalogeintrag zu pruefen - nur benennen, damit klar ist, dass
        // dieser Name bewusst ohne ALTER auskommt.
        console.log(`  ok  ${d.from} -> ${d.to} (abgeleitet, nur in Views/Funktionen)`);
      }
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
          if (!carriers.some((r) => r.table === t.from)) {
            console.log(`  MISSING  ${t.from}."${c.from}" does not exist`);
            problems++;
            continue;
          }
          // Carriers this same run renames to the same target are not conflicts.
          const others = carriers
            .filter((r) => r.table !== t.from)
            .filter((r) => covered.get(`${r.table}.${c.from}`) !== c.to);
          const target = await tablesWithColumn(client, c.to);
          if (target.some((r) => r.table === t.from)) {
            console.log(`  COLLISION  ${t.from}."${c.to}" already exists`);
            problems++;
          }
          if (c.scope === "global" && others.length) {
            console.log(
              `  UNSAFE  ${t.from}."${c.from}" is marked "global" but these tables ` +
                `KEEP that column name: ${others.map(qual).join(", ")}\n` +
                `          -> a repo-wide replace would corrupt those. Either rename it there\n` +
                `             too, or use "scope": "table" and judge each call site by hand.`
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
    // Request-field twins are a code-level concern and never appear in SQL.
    const noteRef = (r, ident) => {
      const key = `${r.kind} ${qual({ schema: r.schema, table: r.name })}`;
      if (!dbRefs.has(key)) dbRefs.set(key, new Set());
      dbRefs.get(key).add(ident);
    };
    for (const [ident, info] of globalReplacements(blocks)) {
      if (info.api) continue;
      for (const r of await dbObjectsReferencing(client, ident)) noteRef(r, ident);
    }
    for (const m of manualColumns(blocks)) {
      for (const r of await dbObjectsReferencing(client, m.from)) noteRef(r, `${m.table}.${m.from}`);
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

    // Identifiers the code assembles at runtime - invisible to replace and guard.
    const dyn = findDynamicSites(dynamicPrefixes(blocks, EXTRA_DYNAMIC_WATCH));
    console.log(`\n=== possible runtime-assembled identifiers ===`);
    if (dyn.length === 0) {
      console.log("  none");
    } else {
      console.log("  Neither the codemod nor the guard can see these - check each one.\n");
      for (const d of dyn) console.log(`  ${d.file}:${d.line}  [${d.prefix}]  ${d.text}`);
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

  // PostgREST caches the schema. Without this it keeps answering from the old
  // one - PGRST204 "column does not exist" - until the container restarts.
  const reload =
    "\n\n-- PostgREST serves from a cached schema; without this it keeps using the old one.\n" +
    "NOTIFY pgrst, 'reload schema';\n";

  const upFile = path.join(MIGRATIONS_DIR, `${num}_${slug}.sql`);
  const downFile = path.join(HERE, `${num}_${slug}_DOWN.sql`);

  fs.writeFileSync(upFile, header("up") + upLines.join("\n") + reload);
  fs.writeFileSync(
    downFile,
    header("down") +
      "-- Not a migration. Paste into the SQL editor to undo the block.\n\n" +
      downLines.join("\n") + reload
  );

  console.log(`\n  wrote  ${path.relative(REPO, upFile)}`);
  console.log(`  wrote  ${path.relative(REPO, downFile)}   (rollback, not tracked by migrate.js)`);
  console.log(`\n  Reminder: plpgsql functions are NOT covered - run "check" and rewrite them.\n`);
}

function cmdApply(blocks) {
  // The whole point of blocks is that one lands at a time. Rewriting all of
  // them in one pass is almost always a slip, so it has to be said out loud.
  if (WRITE && !BLOCK_FILTER && blocks.length > 1 && !args.includes("--all")) {
    fail(
      `apply --write would rewrite all ${blocks.length} planned blocks at once.\n` +
        `          Pass --block <id> for one block, or --all if you really mean it.`
    );
  }
  for (const b of blocks) {
    if (b.note) console.log(`
  ${b.id}: ${b.note}
`);
  }

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
      const twin = apiTwin(m);
      const re = buildRegex(twin ? [m.from, twin.from] : [m.from]);
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

  reportDynamicSites(blocks);
}

/** Shared by apply and guard - the blind spot both of them have. */
function reportDynamicSites(blocks) {
  const dyn = findDynamicSites(dynamicPrefixes(blocks, EXTRA_DYNAMIC_WATCH));
  if (dyn.length) {
    console.log("=== runtime-assembled identifiers - not covered above ===");
    console.log("  A word-boundary replace cannot see `SURCHARGE_${i}_LABEL`, and the guard");
    console.log("  cannot either, because the token is never written out. Check each one.\n");
    for (const d of dyn) console.log(`  ${d.file}:${d.line}  [${d.prefix}]  ${d.text}`);
    console.log();
  }
  if (ALWAYS_REVIEW.length) {
    // These build the column name entirely from a variable, e.g.
    // .select(`ID, ${numberCol}, ${dateCol}`) - no prefix search can find them.
    console.log("=== files that build column names from variables - read them every block ===");
    for (const f of ALWAYS_REVIEW) console.log(`  ${f}`);
    console.log();
  }
}

function cmdGuard(blocks) {
  const tokens = new Map();
  for (const [from, info] of globalReplacements(blocks)) tokens.set(from, info.what);
  for (const m of manualColumns(blocks)) {
    tokens.set(m.from, `${m.table}.${m.from}`);
    const twin = apiTwin(m);
    if (twin) tokens.set(twin.from, `${m.table}.${m.from} (request field)`);
  }

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
    reportDynamicSites(blocks);
    return;
  }
  console.log(`\n  ${leftovers.length} leftover occurrence(s):\n`);
  for (const l of leftovers) console.log(`  ${l.file}:${l.line}   ${l.token}`);
  console.log(
    "\n  Note: backend/migrations/, backend/sql/ and docs/ are deliberately not" +
      "\n  scanned - migration history stays as written.\n"
  );
  reportDynamicSites(blocks);
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
          if (!carriers.some((r) => r.table === live)) { console.log(`  FAIL  ${live}."${c.to}" missing`); bad++; }
          const oldCarriers = await tablesWithColumn(client, c.from);
          if (oldCarriers.some((r) => r.table === live)) { console.log(`  FAIL  ${live}."${c.from}" still exists`); bad++; }
        }
      }
    }

    // ALTER ... RENAME leaves plpgsql bodies and view output columns untouched.
    // Without this the block looks verified while a report function still
    // carries the old name and only breaks when someone calls it.
    for (const [ident, info] of globalReplacements(blocks)) {
      if (info.api) continue; // request fields never appear in SQL
      for (const r of await dbObjectsReferencing(client, ident)) {
        console.log(`  FAIL  ${r.kind} ${qual({ schema: r.schema, table: r.name })} still mentions "${ident}"`);
        bad++;
      }
    }
    // A "table"-scoped name legitimately survives on the tables left alone, so
    // its remaining references are a reading task, not a failure.
    const stillAmbiguous = [];
    for (const m of manualColumns(blocks)) {
      for (const r of await dbObjectsReferencing(client, m.from)) {
        stillAmbiguous.push(`${r.kind} ${qual({ schema: r.schema, table: r.name })}  <- ${m.table}.${m.from}`);
      }
    }
    if (stillAmbiguous.length) {
      console.log(`\n  Still mentioning a "table"-scoped name (may be correct - confirm which table each one reads):`);
      for (const s of [...new Set(stillAmbiguous)].sort()) console.log(`    ${s}`);
    }

    console.log(bad === 0 ? "\n  DB matches the map.\n" : `\n  ${bad} mismatch(es).\n`);
    if (bad) process.exitCode = 1;
  });
}

// ---------------------------------------------------------------------- main

async function main() {
  const commands = {
    check: cmdCheck, sql: cmdSql, functions: cmdFunctions,
    apply: cmdApply, guard: cmdGuard, verify: cmdVerify,
  };
  const fn = commands[CMD];
  if (!fn) {
    console.log("\nUsage: node backend/scripts/rename/rename.js <check|sql|functions|apply|guard|verify> [--block ID] [--write]\n");
    process.exit(1);
  }
  await fn(loadBlocks());
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
