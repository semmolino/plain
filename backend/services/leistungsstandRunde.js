"use strict";

/**
 * Leistungsstaende zum Stichtag und die Monatsrunde (UI-Pilot Runde 2,
 * Migration 0170).
 *
 * Einmal im Monat pflegen Projektleitung und Buero die Leistungsstaende aller
 * laufenden Projekte — je Projekt zwei bis zehn Elemente. Vorher hiess das:
 * Projekt oeffnen, Reiter, tippen, speichern, naechstes Projekt suchen. Es gab
 * keine Liste „was ist noch offen", und der Stand galt ab dem Speichern:
 * der September-Stand, am 3. Oktober eingetragen, war ein Oktober-Stand.
 *
 * Hier stehen die drei Bausteine dafuer:
 *   - normalizeAsOf / laterStands: darf zu diesem Stichtag gespeichert werden?
 *   - markReviewed:  „fuer Stichtag X erledigt" am Projekt vermerken
 *   - listRunde:     die Arbeitsliste der Monatsrunde
 *
 * Die Regel, auf der die Stichtagsberichte beruhen (0170): je Element steigt
 * AS_OF_DATE in Erfassungsreihenfolge nie ab. laterStands ist die Stelle, die
 * sie beim Speichern durchsetzt.
 */

const { localDateStr } = require("./notificationSchedule");
const { runningStatusIds } = require("./eigeneZeit");

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Heute in der App-Zeitzone (Europe/Berlin). */
const today = () => localDateStr(new Date());

/** Letzter Tag des Vormonats — die Vorbelegung der Monatsrunde. */
function lastMonthEnd(iso = today()) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

const deDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Stichtag pruefen. Leer → heute; nicht in der Zukunft.
 */
function normalizeAsOf(asOf) {
  const t = today();
  const d = asOf == null || asOf === "" ? t : String(asOf);
  if (!ISO.test(d) || Number.isNaN(Date.parse(d))) {
    throw { status: 400, message: "Stichtag im Format JJJJ-MM-TT angeben" };
  }
  if (d > t) throw { status: 400, message: `Der Stichtag ${deDate(d)} liegt in der Zukunft.` };
  return d;
}

/**
 * Elemente, die schon einen Stand NACH dem Stichtag haben (id → juengster Stichtag).
 *
 * Die Regel aus 0170 gilt je Element, nicht je Projekt: ein am 2.10. neu
 * angelegtes Element hat einen Stand zum 2.10. — das darf den September-Stand
 * der anderen Elemente nicht sperren. Fuer ein Element mit spaeterem Stand
 * wird zum frueheren Stichtag nichts geschrieben: ein nachgetragener alter
 * Stand darf die Live-Werte (daraus rechnet der Abrechnungsvorschlag) nie
 * zurueckdrehen, und er braeche die Reihenfolge, auf der die Berichte beruhen.
 */
async function laterStands(supabase, { tenantId, structureIds, asOf }) {
  const out = new Map();
  if (!structureIds.length) return out;
  const { data, error } = await supabase
    .from("PROJECT_PROGRESS")
    .select("STRUCTURE_ID, AS_OF_DATE")
    .eq("TENANT_ID", tenantId)
    .in("STRUCTURE_ID", structureIds.map(Number))
    .gt("AS_OF_DATE", asOf);
  if (error) throw { status: 500, message: error.message };
  for (const r of data || []) {
    const sid = String(r.STRUCTURE_ID);
    const d = String(r.AS_OF_DATE).slice(0, 10);
    if (!out.has(sid) || out.get(sid) < d) out.set(sid, d);
  }
  return out;
}

async function markReviewed(supabase, { tenantId, projectId, asOf, employeeId }) {
  const { error } = await supabase
    .from("PROJECT")
    .update({
      PROGRESS_REVIEWED_AS_OF: asOf,
      PROGRESS_REVIEWED_AT:    new Date().toISOString(),
      PROGRESS_REVIEWED_BY:    employeeId ?? null,
    })
    .eq("ID", projectId)
    .eq("TENANT_ID", tenantId);
  if (error) throw { status: 500, message: error.message };
}

/**
 * Arbeitsliste der Monatsrunde.
 *
 * Laufende Projekte (Status aus Einstellungen → Monatsabschluss; nicht gesetzt:
 * alle), mit mindestens einem Element, dessen Leistungsstand man eingibt
 * (Blatt, Pauschal). Nachweis-Elemente stehen immer auf 100 % — ein Projekt
 * nur aus solchen hat nichts zu pflegen und fehlt deshalb.
 *
 * „Meine" ist ein Filter (Projektleitung = ich), keine Rechtegrenze — wie die
 * Projektliste auch.
 */
async function listRunde(supabase, { tenantId, employeeId, asOf, scope = "own" }) {
  const stichtag = asOf ? String(asOf) : lastMonthEnd();
  if (!ISO.test(stichtag)) throw { status: 400, message: "as_of im Format JJJJ-MM-TT angeben" };

  const statusIds = await runningStatusIds(supabase, tenantId);
  let pq = supabase
    .from("PROJECT")
    .select("ID, ABBR, NAME, PROJECT_MANAGER_ID, PROJECT_STATUS_ID, PROGRESS_REVIEWED_AS_OF, PROGRESS_REVIEWED_AT")
    .eq("TENANT_ID", tenantId)
    .order("ABBR", { ascending: true });
  if (statusIds.length) pq = pq.in("PROJECT_STATUS_ID", statusIds);
  const { data: projects, error: pErr } = await pq;
  if (pErr) throw { status: 500, message: pErr.message };

  const all = projects || [];
  const mineCount = all.filter(p => Number(p.PROJECT_MANAGER_ID) === Number(employeeId)).length;
  const scoped = scope === "all" ? all : all.filter(p => Number(p.PROJECT_MANAGER_ID) === Number(employeeId));
  if (!scoped.length) {
    return { as_of: stichtag, today: today(), scope, mine_count: mineCount, total: 0, done: 0, projects: [] };
  }
  const ids = scoped.map(p => p.ID);

  // Eingebbare Elemente je Projekt: Blaetter mit Pauschal-Abrechnung.
  const { data: structs, error: sErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID, FATHER_ID, BILLING_TYPE_ID")
    .eq("TENANT_ID", tenantId)
    .in("PROJECT_ID", ids);
  if (sErr) throw { status: 500, message: sErr.message };
  const parents = new Set((structs || []).filter(s => s.FATHER_ID != null).map(s => String(s.FATHER_ID)));
  const editable = new Map();
  for (const s of structs || []) {
    if (parents.has(String(s.ID)) || Number(s.BILLING_TYPE_ID) === 2) continue;
    editable.set(String(s.PROJECT_ID), (editable.get(String(s.PROJECT_ID)) || 0) + 1);
  }

  // Leistungsstand, Honorar, offener Betrag und Projektleitung aus der Berichtsansicht.
  const { data: rep } = await supabase
    .from("VW_REPORT_PROJECT_DETAIL")
    .select("PROJECT_ID, PROJECT_MANAGER_DISPLAY, PROJECT_STATUS_NAME_SHORT, BUDGET_TOTAL_NET, LEISTUNGSSTAND_PERCENT, LEISTUNGSSTAND_VALUE, BILLED_NET_TOTAL, OPEN_NET_TOTAL")
    .eq("TENANT_ID", tenantId)
    .in("PROJECT_ID", ids);
  const repById = new Map((rep || []).map(r => [String(r.PROJECT_ID), r]));

  const out = [];
  for (const p of scoped) {
    const leaves = editable.get(String(p.ID)) || 0;
    if (!leaves) continue;
    const r = repById.get(String(p.ID)) || {};
    const reviewed = p.PROGRESS_REVIEWED_AS_OF ? String(p.PROGRESS_REVIEWED_AS_OF).slice(0, 10) : null;
    out.push({
      ID:                   p.ID,
      ABBR:                 p.ABBR,
      NAME:                 p.NAME,
      PROJECT_MANAGER_ID:   p.PROJECT_MANAGER_ID,
      PROJECT_MANAGER:      r.PROJECT_MANAGER_DISPLAY ?? null,
      STATUS:               r.PROJECT_STATUS_NAME_SHORT ?? null,
      EDITABLE_COUNT:       leaves,
      BUDGET_TOTAL_NET:     r.BUDGET_TOTAL_NET != null ? Number(r.BUDGET_TOTAL_NET) : null,
      LEISTUNGSSTAND_PERCENT: r.LEISTUNGSSTAND_PERCENT != null ? Number(r.LEISTUNGSSTAND_PERCENT) : null,
      OPEN_NET_TOTAL:       r.OPEN_NET_TOTAL != null ? Number(r.OPEN_NET_TOTAL) : null,
      REVIEWED_AS_OF:       reviewed,
      REVIEWED_AT:          p.PROGRESS_REVIEWED_AT ?? null,
      // Erledigt, sobald fuer diesen oder einen spaeteren Stichtag gepflegt —
      // wer am 5.10. im Projekt gespeichert hat, muss den 30.09. nicht nachholen
      // (und koennte es fuer diese Elemente auch nicht, siehe laterStands).
      DONE:                 !!reviewed && reviewed >= stichtag,
    });
  }
  return {
    as_of: stichtag, today: today(), scope, mine_count: mineCount,
    total: out.length, done: out.filter(x => x.DONE).length,
    projects: out,
  };
}

/** Kurzfassung fuer „Jetzt wichtig": eigene Projekte, sonst alle. */
async function roundSummary(supabase, { tenantId, employeeId }) {
  const own = await listRunde(supabase, { tenantId, employeeId, scope: "own" });
  const r = own.total > 0 ? own : await listRunde(supabase, { tenantId, employeeId, scope: "all" });
  return { as_of: r.as_of, scope: r.scope, total: r.total, open: r.total - r.done };
}

module.exports = { today, lastMonthEnd, deDate, normalizeAsOf, laterStands, markReviewed, listRunde, roundSummary };
