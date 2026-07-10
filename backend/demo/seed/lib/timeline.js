"use strict";

/**
 * Projekt-Timeline: Da PROJECT keine Start-/Enddaten führt, kuratiert eine
 * timeline-Datei, in welchem Zeitfenster ein Projekt "lief" — das ist die Basis
 * für den zeitlichen Verlauf aller Bewegungsdaten (Buchungen, Rechnungen …).
 *
 * Ablauf:
 *   1) `node index.js --tenant N --emit-timeline`  → schreibt eine Vorlage mit
 *      sinnvollen Default-Fenstern (aus Angebots-/Auftragsdatum abgeleitet).
 *   2) Du passt Start/Ende/closed pro Projekt an (das "Narrativ").
 *   3) Der Generator liest die Datei und richtet alle Bewegungsdaten daran aus.
 */

const fs = require("fs");
const path = require("path");
const { addDays, todayISO } = require("./calendar");

function timelinePath(tenantId, override) {
  if (override) return path.resolve(override);
  return path.resolve(__dirname, "..", `timeline.${tenantId}.json`);
}

// Grobe Default-Laufzeit (Monate) nach Honorarvolumen des Projekts.
function defaultDurationMonths(revenueTotal) {
  const v = Number(revenueTotal) || 0;
  if (v <= 0) return 12;
  if (v < 30000) return 8;
  if (v < 80000) return 14;
  if (v < 200000) return 22;
  return 30;
}

function sumLeafRevenue(project) {
  return (project.leaves || []).reduce((s, l) => s + (Number(l.REVENUE) || 0), 0);
}

/**
 * Baut Default-Timeline-Einträge. Projekte werden — falls kein Angebotsdatum
 * vorliegt — gleichmäßig über die letzten `spanYears` Jahre gestaffelt, damit
 * die Demo einen mehrjährigen Verlauf zeigt.
 */
function buildDefaults(md, spanYears = 4) {
  const today = todayISO();
  const spanStart = addDays(today, -Math.round(spanYears * 365));
  const n = md.projects.length || 1;

  return md.projects.map((p, idx) => {
    const rev = sumLeafRevenue(p);
    const durMonths = defaultDurationMonths(rev);

    // Startdatum: Auftrags-/Angebotsdatum bevorzugt, sonst gestaffelt verteilt.
    let start =
      p.offer?.ORDER_DATE ||
      p.offer?.OFFER_DATE ||
      addDays(spanStart, Math.round((idx / n) * (spanYears * 365 * 0.7)));
    start = String(start).slice(0, 10);

    let end = addDays(start, Math.round(durMonths * 30.4));
    const closed = end < today;
    if (!closed) end = today; // laufendes Projekt endet "heute"

    return {
      projectId: p.ID,
      name: p.NAME_SHORT || p.NAME_LONG || String(p.ID),
      revenue: Math.round(rev),
      start,
      end,
      closed,
      intensity: 1.0,
    };
  });
}

function emitTemplate(md, override) {
  const file = timelinePath(md.tenantId, override);
  const doc = {
    tenantId: md.tenantId,
    note: "Start/Ende/closed pro Projekt anpassen. 'closed:true' ⇒ Schlussrechnung. intensity skaliert das Buchungsvolumen.",
    generatedAt: new Date().toISOString(),
    projects: buildDefaults(md),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
  return file;
}

function load(md, override) {
  const file = timelinePath(md.tenantId, override);
  if (!fs.existsSync(file)) return { file, exists: false, byProject: new Map() };
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const byProject = new Map((doc.projects || []).map((e) => [String(e.projectId), e]));
  return { file, exists: true, byProject, doc };
}

module.exports = { timelinePath, emitTemplate, load, buildDefaults, sumLeafRevenue };
