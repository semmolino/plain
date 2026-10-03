"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Ein PostgREST-Aufruf kennt kein .catch().
//
// supabase.from(...).insert(...) liefert einen Builder, der nur `then` hat —
// er ist PromiseLike, kein Promise. `await supabase.from("X").insert(r).catch(…)`
// ruft deshalb `undefined` auf und wirft einen TypeError, BEVOR die Anfrage
// ueberhaupt rausgeht. Gemeint war „Fehler ignorieren", herausgekommen ist:
//   - in einem Soft-Fail-try: der Schritt fehlt still (Leistungsstaende der
//     Besonderen Leistungen im HOAI-Assistenten entstanden so nie),
//   - sonst: der ganze Vorgang kippt mit einem 500er (Aufraeumen nach einem
//     gescheiterten Signup brach selbst ab).
//
// Fehler ignorieren heisst hier: `const { error } = await …` und auswerten
// oder bewusst liegen lassen. Der Builder wirft nicht, er liefert { error }.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", "tests", "coverage"]);

function* jsDateien(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsDateien(p);
    else if (e.name.endsWith(".js")) yield p;
  }
}

// Vom Tabellen- bzw. RPC-Aufruf bis zum .catch( innerhalb derselben Anweisung.
// Steht ein .then( dazwischen, ist es ein echtes Promise — das darf .catch.
const MUSTER = /\.(?:from|rpc)\(\s*["'`]\w+["'`][^;]*?\.catch\(/g;

function befunde(quelltext) {
  return (quelltext.match(MUSTER) || []).filter((m) => !m.includes(".then("));
}

describe("kein .catch() an einem PostgREST-Aufruf", () => {
  it("das Muster erkennt den Fehler (Gegenprobe)", () => {
    expect(befunde(`await supabase.from("PROJECT_PROGRESS").insert(rows).catch(() => {});`)).toHaveLength(1);
    expect(befunde(`await supabase.from('X').update({\n  A: 1,\n}).eq('ID', id).catch(() => {});`)).toHaveLength(1);
    expect(befunde(`await supabase.rpc("fn", { a: 1 }).catch(() => {});`)).toHaveLength(1);
    expect(befunde(`supabase.from("X").select("*").then((r) => r).catch(() => {});`)).toHaveLength(0);
    expect(befunde(`const { error } = await supabase.from("X").insert(r);\nawait storage.remove(k).catch(() => {});`)).toHaveLength(0);
  });

  it("steht nirgends im Backend", () => {
    const treffer = [];
    for (const datei of jsDateien(ROOT)) {
      for (const m of befunde(fs.readFileSync(datei, "utf8"))) {
        treffer.push(`${path.relative(ROOT, datei)}: ${m.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(treffer).toEqual([]);
  });
});
