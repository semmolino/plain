"use strict";

// ============================================================================
// db.js — ein Datenbank-Client je Request statt eines geteilten Service-Keys
//
// WARUM ES DAS GIBT
//   Bisher erzeugt server.js EINEN Client mit dem Supabase-Service-Key, den
//   sich alle Requests teilen. Der Service-Key umgeht RLS per Definition —
//   deshalb wirkt bis heute keine einzige der vorhandenen Policies, und die
//   Mandantentrennung haengt allein daran, dass in jeder der rund 1.571
//   Abfragen ein .eq("TENANT_ID", …) steht. Ein Vergessen genuegt (Pentest
//   2026-08-06).
//
//   Mit PostgREST davor bekommt jeder Request ein eigenes, kurzlebiges JWT mit
//   dem Mandanten als Claim. PostgREST legt die Claims als GUC ab,
//   current_tenant_id() liest sie, die Policies greifen. Die Trennung wandert
//   damit von der Anwendung in die Datenbank.
//
// WIE ES OHNE UMBAU DER AUFRUFSTELLEN GEHT
//   server.js reicht den Client beim Start in 36 Router hinein
//   (require("./routes/x")(supabase)). Ein Client PRO REQUEST passt da nicht
//   hinein — es sei denn, das hineingereichte Objekt ist gar kein Client,
//   sondern ein Stellvertreter, der bei JEDEM Zugriff nachsieht, in wessen
//   Auftrag er gerade arbeitet.
//
//   Genau das ist `db`: ein Proxy ueber AsyncLocalStorage. Die Router, die
//   Services und alle 1.571 supabase.from(...)-Aufrufe bleiben unveraendert.
//   Voraussetzung dafuer war, dass nirgends destrukturiert wird
//   (const { from } = supabase) — geprueft, kommt nicht vor.
//
// SCHALTER STATT UMBAU
//   Ohne POSTGREST_URL verhaelt sich alles exakt wie bisher: ein Client mit
//   dem Service-Key, kein AsyncLocalStorage, kein JWT. Die Umstellung ist
//   damit eine Umgebungsvariable — und der Rueckweg auch.
// ============================================================================

const { AsyncLocalStorage } = require("node:async_hooks");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const POSTGREST_URL = process.env.POSTGREST_URL || "";
const AKTIV = POSTGREST_URL !== "";

// Kurz halten. Das Token wandert nur ueber Loopback zu PostgREST im selben
// Container; eine lange Gueltigkeit brauchte es nur, wenn es irgendwo lagerte.
const TOKEN_MINUTEN = 5;

const als = new AsyncLocalStorage();

// ── Alter Weg: direkt gegen Supabase ────────────────────────────────────────

let legacy = null;
function legacyClient() {
  if (!legacy) {
    legacy = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return legacy;
}

// ── Neuer Weg: PostgREST mit Claims ─────────────────────────────────────────

// Je Geltungsbereich EIN Client, bis sein Token abzulaufen droht. Ein Client
// ist zwar billig (supabase-js baut nur Konfiguration auf, keine Verbindung),
// aber ein Signieren je Abfrage waere trotzdem Verschwendung — und die Zahl
// der Bereiche ist klein: ein Mandant je aktivem Nutzer, plus "system".
const clients = new Map();

// ── Der Pfad ────────────────────────────────────────────────────────────────
// supabase-js haengt an die Basis-URL immer "/rest/v1" an. Bei Supabase liegt
// davor ein Gateway, das diesen Pfad auf PostgREST abbildet; ein nacktes
// PostgREST kennt ihn nicht und antwortet auf jede Abfrage mit
//     {"code":"PGRST125","message":"Invalid path specified in request URL"}
//
// Das war die Annahme, die im Migrationskonzept fehlte: supabase-js spricht
// zwar PostgREST, aber nicht dessen Pfade. Statt einen Reverse-Proxy davor zu
// stellen, wird der Praefix hier beim Absenden entfernt — eine Stelle, kein
// zusaetzlicher Prozess, und es gilt auch fuer /rest/v1/rpc/<funktion>.
function pfadKorrigieren(url) {
  return String(url).replace(POSTGREST_URL + "/rest/v1", POSTGREST_URL);
}

function fetchOhnePraefix(eingabe, init) {
  if (typeof eingabe === "string" || eingabe instanceof URL) {
    return fetch(pfadKorrigieren(eingabe), init);
  }
  // Request-Objekt: URL laesst sich nicht aendern, also neu aufbauen.
  return fetch(new Request(pfadKorrigieren(eingabe.url), eingabe), init);
}

function scopedClient(schluessel, claims) {
  const jetzt = Date.now();
  const treffer = clients.get(schluessel);
  // 30 Sekunden Sicherheitsabstand: ein Token, das mitten in einer laufenden
  // Abfrage ablaeuft, liefert 401 statt Daten.
  if (treffer && treffer.gueltigBis > jetzt + 30_000) return treffer.client;

  const token = jwt.sign(claims, process.env.PGRST_JWT_SECRET, { expiresIn: `${TOKEN_MINUTEN}m` });
  const client = createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: fetchOhnePraefix,
    },
  });

  clients.set(schluessel, { client, gueltigBis: jetzt + TOKEN_MINUTEN * 60_000 });
  return client;
}

// ── Die Rolle im Token ──────────────────────────────────────────────────────
// PostgREST BRAUCHT einen role-Claim. Fehlt er und ist kein db-anon-role
// konfiguriert, wird jeder Request abgewiesen:
//     {"code":"PGRST302","message":"Anonymous access is disabled"}   401
// Fuer den Login sah das aus wie "Benutzer unbekannt", weil der Handler
// Lookup-Fehler bewusst verschluckt — der Fehler tauchte nirgends auf.
//
// Die Rolle muss in der Datenbank EXISTIEREN, sonst scheitert PostgREST beim
// SET LOCAL ROLE. Ein ausgedachter Name wie "plain_app" geht hier nicht: auf
// Scalingo fehlt CREATEROLE, um ihn anzulegen. Genommen wird deshalb der
// Verbindungsbenutzer selbst.
//
// Das schwaecht die Trennung nicht: die Rolle hat rolbypassrls = false, und
// 05_rls_scalingo.sql setzt FORCE ROW LEVEL SECURITY — die Policies gelten
// also auch fuer den Tabelleneigentuemer.
//
// Ohne PGRST_ROLE wird der Name aus der Datenbank-URL abgeleitet. Damit bleibt
// die Anwendung richtig, wenn das Addon einmal neu angelegt wird und der
// Benutzername sich aendert.
function ermittleRolle() {
  if (process.env.PGRST_ROLE) return process.env.PGRST_ROLE;
  const url = process.env.SCALINGO_POSTGRESQL_URL || process.env.DATABASE_URL || "";
  const treffer = url.match(/^postgres(?:ql)?:\/\/([^:@/]+)/);
  return treffer ? treffer[1] : null;
}
const ROLLE = ermittleRolle();
const mitRolle = (claims) => (ROLLE ? { role: ROLLE, ...claims } : claims);

const tenantClient = (tenantId) =>
  scopedClient(`t:${tenantId}`, mitRolle({ tenant_id: Number(tenantId) }));

const systemClient = () =>
  scopedClient("system", mitRolle({ sys: "true" }));

// Ohne Mandanten und ohne Systemanspruch. Die Policies finden keinen Mandanten
// und liefern keine Zeile — das ist der Zustand, in dem ein Programmfehler
// landen SOLL. Frueher waere derselbe Fehler mit Service-Key-Rechten
// weitergelaufen und haette alle Mandanten gesehen.
//
// Ein leeres Claim-Objekt waere hier falsch: jwt.sign({}) erzeugt ein Token
// ohne Nutzlast, und PostgREST setzt request.jwt.claims dann auf einen leeren
// Wert. Genau dagegen ist current_tenant_id() inzwischen abgesichert, aber der
// Marker macht ausserdem im Log erkennbar, woher die Abfrage kam.
const anonymerClient = () => scopedClient("anon", mitRolle({ scope: "none" }));

let warnungGezeigt = false;
function ohneKontext() {
  if (!warnungGezeigt) {
    warnungGezeigt = true;
    console.warn(
      "[db] Datenbankzugriff ausserhalb eines Request- oder Systemkontexts. " +
      "Die Abfrage laeuft ohne Mandanten-Claim und liefert daher keine Zeilen. " +
      "Ursache suchen: fehlt tenantScope in der Kette, oder ein Hintergrunddienst " +
      "ohne runAsSystem?"
    );
  }
  return anonymerClient();
}

// ── Der Stellvertreter ──────────────────────────────────────────────────────

function aktuellerClient() {
  if (!AKTIV) return legacyClient();
  const kontext = als.getStore();
  if (!kontext) return ohneKontext();
  return kontext.client;
}

const db = new Proxy(Object.create(null), {
  get(_ziel, eigenschaft) {
    const client = aktuellerClient();
    const wert = client[eigenschaft];
    // Methoden an ihren echten Client binden — sonst zeigt `this` im Inneren
    // von supabase-js auf den Proxy und die Kette bricht.
    return typeof wert === "function" ? wert.bind(client) : wert;
  },
  has(_ziel, eigenschaft) {
    return eigenschaft in aktuellerClient();
  },
});

// ── Geltungsbereiche ────────────────────────────────────────────────────────

// Express-Middleware. Gehoert HINTER authMiddleware — davor gibt es noch
// keinen req.tenantId.
function tenantScope(req, _res, next) {
  if (!AKTIV) return next();
  if (!req.tenantId) return next();          // oeffentliche Route: kein Mandant
  als.run({ client: tenantClient(req.tenantId) }, next);
}

// Fuer die wenigen mandantenuebergreifenden Vorgaenge: die sechs
// Hintergrund-Checker, der Signup (legt einen neuen Mandanten an) und die
// Owner-Konsole. DIESE LISTE KURZ ZU HALTEN IST DIE EIGENTLICHE
// SICHERHEITSARBEIT — jede Erweiterung schwaecht die Trennung wieder auf.
//
// Der Kontext traegt auch in setTimeout/setInterval hinein, die innerhalb von
// fn geplant werden. Deshalb genuegt es, den start…Checker-Aufruf zu umhuellen.
function runAsSystem(fn) {
  if (!AKTIV) return fn();
  return als.run({ client: systemClient() }, fn);
}

// Dasselbe als Express-Middleware, fuer die oeffentlichen Router.
//
// WARUM SIE NOETIG IST: tenantScope haengt in der authChain und setzt den
// Mandanten aus req.tenantId. Die oeffentlichen Router laufen daran vorbei —
// per Definition, denn dort gibt es noch keine Anmeldung. Ohne systemScope
// landen sie im claimlosen Rueckfall, und der liefert null Zeilen. Der Login
// wuerde den Benutzer dann nicht finden und "unbekannt" melden, ohne dass
// irgendwo ein Fehler auftaucht — der stillste aller Ausfaelle.
//
// Der Login MUSS mandantenuebergreifend suchen: die E-Mail-Adresse ist der
// einzige Anhaltspunkt, der Mandant ergibt sich erst aus dem Fund. Das ist
// nicht zu vermeiden und der Grund, warum diese Router eine Ausnahme bilden.
function systemScope(_req, _res, next) {
  if (!AKTIV) return next();
  als.run({ client: systemClient() }, next);
}

function assertConfigured() {
  if (!AKTIV) return;
  const fehlend = ["PGRST_JWT_SECRET"].filter((v) => !process.env[v]);
  if (fehlend.length) {
    throw new Error(`POSTGREST_URL ist gesetzt, aber es fehlt: ${fehlend.join(", ")}`);
  }
  // Ohne Rolle weist PostgREST jeden Request mit PGRST302 ab. Das aeussert
  // sich als leere Ergebnisse statt als Fehler — der Login meldete deshalb
  // "Benutzer unbekannt", und im Log stand nichts. Lieber beim Start abbrechen.
  if (!ROLLE) {
    throw new Error(
      "POSTGREST_URL ist gesetzt, aber es liess sich keine Datenbankrolle ermitteln. " +
      "PGRST_ROLE setzen (Name des Verbindungsbenutzers) oder SCALINGO_POSTGRESQL_URL bereitstellen."
    );
  }
}

module.exports = {
  db,
  tenantScope,
  systemScope,
  runAsSystem,
  assertConfigured,
  mode: () => (AKTIV ? "postgrest" : "supabase"),
  // nur fuer Tests
  _pfadKorrigieren: pfadKorrigieren,
  _als: als,
  _resetForTests: () => { clients.clear(); legacy = null; warnungGezeigt = false; },
};
