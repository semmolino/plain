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

function scopedClient(schluessel, claims) {
  const jetzt = Date.now();
  const treffer = clients.get(schluessel);
  // 30 Sekunden Sicherheitsabstand: ein Token, das mitten in einer laufenden
  // Abfrage ablaeuft, liefert 401 statt Daten.
  if (treffer && treffer.gueltigBis > jetzt + 30_000) return treffer.client;

  const token = jwt.sign(claims, process.env.PGRST_JWT_SECRET, { expiresIn: `${TOKEN_MINUTEN}m` });
  const client = createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  clients.set(schluessel, { client, gueltigBis: jetzt + TOKEN_MINUTEN * 60_000 });
  return client;
}

// KEIN role-Claim. Traegt das JWT einen, versucht PostgREST bei jedem Request
// ein SET LOCAL ROLE — und bricht ab, wenn es die Rolle nicht gibt:
//     ERROR: role "plain_app" does not exist
// Auf Scalingo gibt es sie nicht und kann es sie nicht geben: der
// Datenbankbenutzer hat kein CREATEROLE. Die Abfragen laufen deshalb unter dem
// Verbindungsbenutzer, und die Trennung kommt allein aus den Claims. Das ist
// gleichwertig, weil 05_rls_scalingo.sql FORCE ROW LEVEL SECURITY setzt — ohne
// das wuerde der Tabelleneigentuemer die Policies stillschweigend umgehen.
const tenantClient = (tenantId) =>
  scopedClient(`t:${tenantId}`, { tenant_id: Number(tenantId) });

const systemClient = () =>
  scopedClient("system", { sys: "true" });

// Ohne Mandanten und ohne Systemanspruch. Die Policies finden keinen Mandanten
// und liefern keine Zeile — das ist der Zustand, in dem ein Programmfehler
// landen SOLL. Frueher waere derselbe Fehler mit Service-Key-Rechten
// weitergelaufen und haette alle Mandanten gesehen.
//
// Ein leeres Claim-Objekt waere hier falsch: jwt.sign({}) erzeugt ein Token
// ohne Nutzlast, und PostgREST setzt request.jwt.claims dann auf einen leeren
// Wert. Genau dagegen ist current_tenant_id() inzwischen abgesichert, aber der
// Marker macht ausserdem im Log erkennbar, woher die Abfrage kam.
const anonymerClient = () => scopedClient("anon", { scope: "none" });

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
}

module.exports = {
  db,
  tenantScope,
  systemScope,
  runAsSystem,
  assertConfigured,
  mode: () => (AKTIV ? "postgrest" : "supabase"),
  // nur fuer Tests
  _als: als,
  _resetForTests: () => { clients.clear(); legacy = null; warnungGezeigt = false; },
};
