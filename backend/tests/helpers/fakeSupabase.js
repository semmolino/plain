"use strict";

// Minimales In-Memory-Supabase-Fake fuer Route-/Service-Tests.
// Unterstuetzt die von den Abwesenheits-Endpoints genutzten Ketten:
//   from().select().eq()/in()/gte()/lte()/is()/or().order().limit()
//   .maybeSingle()/.single()/await  sowie insert/update/upsert/delete.
// `or()` wird bewusst ignoriert (keine Filterung) — nur Soft-Fail-Pfade
// (Feiertage/Notifications) nutzen es, die in Tests leer/geschluckt sind.

// Uebersetzt ein ILIKE-Muster in einen case-insensitiven regulaeren Ausdruck.
// Backslash escaped das FOLGENDE Zeichen (dann literal), "%" und "*" sind
// Platzhalter, alles andere wird literal genommen.
function ilikeRegex(muster) {
  let re = "";
  const s = String(muster);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) { re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%" || c === "*") { re += ".*"; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

function makeFakeSupabase(initial = {}) {
  const tables = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = v.map(r => ({ ...r }));
  let autoId = 1000;

  function from(table) {
    if (!tables[table]) tables[table] = [];
    const filters = [];
    let mode = "select";
    let payload = null;
    let onConflict = null;
    let order = null;
    let limitN = null;
    let countMode = null;   // select("ID", { count: "exact", head: true })
    let headOnly = false;

    const applyFilters = (rows) => rows.filter(r => filters.every(f => {
      const v = r[f.col];
      switch (f.op) {
        case "eq":  return v === f.val;
        case "neq": return v !== f.val;
        case "in":  return f.val.includes(v);
        case "gte": return v >= f.val;
        case "lte": return v <= f.val;
        case "lt":  return v <  f.val;
        case "is":  return f.val === null ? (v === null || v === undefined) : v === f.val;
        // .not(col, "is", null) — die einzige not-Form, die im Code vorkommt.
        case "notIs": return f.val === null ? (v !== null && v !== undefined) : v !== f.val;
        case "ilike": return f.val.test(String(v ?? ""));
        default:    return true;
      }
    }));

    const run = () => {
      const rows = tables[table];
      if (mode === "insert") {
        const added = (Array.isArray(payload) ? payload : [payload]).map(r => ({ ID: r.ID ?? ++autoId, ...r }));
        tables[table].push(...added);
        return { data: added, error: null };
      }
      if (mode === "upsert") {
        const cols = (onConflict || "").split(",").map(s => s.trim()).filter(Boolean);
        const out = [];
        for (const r of (Array.isArray(payload) ? payload : [payload])) {
          const idx = cols.length ? tables[table].findIndex(x => cols.every(c => x[c] === r[c])) : -1;
          if (idx >= 0) { tables[table][idx] = { ID: tables[table][idx].ID, ...r }; out.push(tables[table][idx]); }
          else { const nr = { ID: ++autoId, ...r }; tables[table].push(nr); out.push(nr); }
        }
        return { data: out, error: null };
      }
      if (mode === "update") {
        const matched = applyFilters(rows);
        for (const m of matched) Object.assign(m, payload);
        return { data: matched.map(r => ({ ...r })), error: null };
      }
      if (mode === "delete") {
        const matched = new Set(applyFilters(rows));
        tables[table] = rows.filter(r => !matched.has(r));
        // PostgREST liefert bei delete().select() die geloeschten Zeilen zurueck —
        // der Import-Rollback zaehlt genau daran, wie viel entfernt wurde.
        return { data: [...matched].map(r => ({ ...r })), error: null };
      }
      let out = applyFilters(rows).map(r => ({ ...r }));
      if (order) out.sort((a, b) => ((a[order.col] > b[order.col] ? 1 : a[order.col] < b[order.col] ? -1 : 0) * (order.asc ? 1 : -1)));
      if (limitN != null) out = out.slice(0, limitN);
      // { count: "exact" } liefert die Trefferzahl; mit head:true ohne Daten.
      if (countMode) return { data: headOnly ? null : out, count: out.length, error: null };
      return { data: out, error: null };
    };

    const builder = {
      select(_cols, opts) {
        if (opts && opts.count) { countMode = opts.count; headOnly = !!opts.head; }
        return builder;
      },
      insert(p) { mode = "insert"; payload = p; return builder; },
      update(p) { mode = "update"; payload = p; return builder; },
      upsert(p, opts) { mode = "upsert"; payload = p; onConflict = opts && opts.onConflict; return builder; },
      delete() { mode = "delete"; return builder; },
      eq(col, val)  { filters.push({ op: "eq",  col, val }); return builder; },
      neq(col, val) { filters.push({ op: "neq", col, val }); return builder; },
      in(col, val)  { filters.push({ op: "in",  col, val }); return builder; },
      gte(col, val) { filters.push({ op: "gte", col, val }); return builder; },
      lte(col, val) { filters.push({ op: "lte", col, val }); return builder; },
      lt(col, val)  { filters.push({ op: "lt",  col, val }); return builder; },
      is(col, val)  { filters.push({ op: "is",  col, val }); return builder; },
      // PostgREST-Semantik nachgebildet: "*" und "%" sind Platzhalter, ein
      // vorangestellter Backslash macht das naechste Zeichen literal. Genau
      // darauf verlaesst sich likeEscape() im Login.
      ilike(col, muster) { filters.push({ op: "ilike", col, val: ilikeRegex(muster) }); return builder; },
      not(col, op, val) { filters.push({ op: op === "is" ? "notIs" : "neq", col, val }); return builder; },
      or() { return builder; },
      order(col, opts) { order = { col, asc: !opts || opts.ascending !== false }; return builder; },
      limit(n) { limitN = n; return builder; },
      // PostgREST liefert bei MEHREREN Treffern einen Fehler, nicht die erste
      // Zeile. Genau daran haing der Login-Fehler bei doppelten E-Mail-
      // Adressen — ein nachsichtiger Fake haette ihn nie gezeigt.
      maybeSingle() {
        const { data, error } = run();
        if (data && data.length > 1) {
          return Promise.resolve({
            data: null,
            error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
          });
        }
        return Promise.resolve({ data: data && data.length ? data[0] : null, error });
      },
      single() { const { data, error } = run(); return Promise.resolve({ data: data && data.length ? data[0] : null, error: (data && data.length) ? error : (error || { message: "No rows" }) }); },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject ? reject(e) : null; } },
    };
    return builder;
  }

  return { from, _tables: tables };
}

module.exports = { makeFakeSupabase };
