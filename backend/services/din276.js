"use strict";

// DIN-276-Kostenermittlung → anrechenbare Kosten (HOAI).
//
// Reine Rechenlogik (kein DB-Zugriff), damit die Regeln per Unit-Test gegen
// Referenzbeispiele abgesichert werden koennen. Die DB-Anbindung (Laden einer
// DIN276_COST_ESTIMATE) liegt im Controller.
//
// Konzept + Herleitung: docs/DIN276_ANRECHENBARE_KOSTEN_CONCEPT.md
//
// ⚠️ Verbindlich ist der HOAI-Gesetzestext + DIN 276-1:2008-12. Die
// Prozentsaetze/Schwellen stehen als benannte Konstanten, damit eine spaetere
// Feinjustierung an genau einer Stelle passiert.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num    = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── § 33 HOAI (Gebaeude und Innenraeume) ──────────────────────────────────────
// Konstanten der KG-400-Regel: technische Anlagen, die der AN NICHT selbst
// fachlich plant/ueberwacht, sind bis 25 % der sonstigen anrechenbaren Kosten
// voll und mit dem uebersteigenden Betrag zur Haelfte anrechenbar.
const GEBAEUDE_KG400_THRESHOLD_PCT = 0.25;
const GEBAEUDE_KG400_ABOVE_FACTOR  = 0.5;

// Fuehrende Hunderter-Kostengruppe aus einem KG-Code ("410" → 400, "300" → 300).
function kgHundred(kgCode) {
  const n = parseInt(String(kgCode == null ? "" : kgCode).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n / 100) * 100;
}

// Summiert Betraege der Kostengruppen eines Hunderters, optional gefiltert.
function sumHundred(groups, hundred, predicate) {
  return (groups || []).reduce((s, g) => {
    if (kgHundred(g.kg ?? g.KG_CODE) !== hundred) return s;
    if (predicate && !predicate(g)) return s;
    return s + num(g.amount ?? g.AMOUNT);
  }, 0);
}

const isSelf = (g) => Boolean(g.isPlannedSelf ?? g.IS_PLANNED_SELF);

/**
 * Anrechenbare Kosten fuer Grundleistungen bei Gebaeuden (§ 33 HOAI).
 *
 * @param {object} estimate
 *   estimate.groups  Array<{ kg|KG_CODE, amount|AMOUNT, isPlannedSelf|IS_PLANNED_SELF, label? }>
 *   estimate.mitverarbeiteteBausubstanz | MITVERARBEITETE_BAUSUBSTANZ  (§ 4 Abs. 3)
 * @returns {{ anrechenbareKosten:number, sonstigeAnrechenbareKosten:number, herleitung:Array }}
 *
 * Regeln (§ 33):
 *  - KG 300 vollstaendig.
 *  - Mitverarbeitete Bausubstanz vollstaendig (§ 4 Abs. 3).
 *  - KG 200 (Herrichten/Erschliessen) und KG 600 (Ausstattung/Kunstwerke) nur,
 *    soweit der AN sie selbst plant/ueberwacht (IS_PLANNED_SELF), dann voll.
 *  - KG 400 selbst geplant: voll. KG 400 fremd geplant: bis 25 % der sonstigen
 *    anrechenbaren Kosten voll, darueber zur Haelfte.
 *  - KG 100, 500, 700: nicht anrechenbar.
 *
 * ⚠️ "Sonstige anrechenbare Kosten" (Basis der 25-%-Schwelle) wird hier als
 * KG 300 + mitverarbeitete Bausubstanz + anrechenbare Anteile KG 200/600
 * angesetzt; selbst geplante KG 400 zaehlen nicht hinein. Diese Auslegung ist
 * gaengig, aber bei Bedarf hier zentral anpassbar.
 */
function anrechenbareKostenGebaeude(estimate) {
  const groups = estimate?.groups || [];
  const bausubstanz = num(estimate?.mitverarbeiteteBausubstanz ?? estimate?.MITVERARBEITETE_BAUSUBSTANZ);

  const kg300       = sumHundred(groups, 300);
  const kg200self   = sumHundred(groups, 200, isSelf);
  const kg600self   = sumHundred(groups, 600, isSelf);
  const kg400self   = sumHundred(groups, 400, isSelf);
  const kg400fremd  = sumHundred(groups, 400, (g) => !isSelf(g));

  const herleitung = [];
  let total = 0;
  const add = (kg, label, basis, ansatz, betrag) => {
    const b = round2(betrag);
    herleitung.push({ kg, label, basis: round2(basis), ansatz, betrag: b });
    total += b;
  };

  if (kg300)      add("300", "Baukonstruktionen", kg300, 100, kg300);
  if (bausubstanz) add("—", "Mitverarbeitete Bausubstanz (§ 4 Abs. 3)", bausubstanz, 100, bausubstanz);
  if (kg200self)  add("200", "Herrichten/Erschließen (selbst geplant)", kg200self, 100, kg200self);
  if (kg600self)  add("600", "Ausstattung/Kunstwerke (selbst geplant)", kg600self, 100, kg600self);

  // Basis der KG-400-Schwelle.
  const sonstige = round2(kg300 + bausubstanz + kg200self + kg600self);

  if (kg400self) add("400", "Technische Anlagen (selbst geplant)", kg400self, 100, kg400self);

  if (kg400fremd > 0) {
    const threshold = round2(sonstige * GEBAEUDE_KG400_THRESHOLD_PCT);
    const fullPart  = Math.min(kg400fremd, threshold);
    const abovePart = Math.max(0, kg400fremd - threshold);
    add("400", `Technische Anlagen (fremd geplant), bis 25 % v. ${round2(sonstige)}`, fullPart, 100, fullPart);
    if (abovePart > 0) {
      add("400", "Technische Anlagen (fremd geplant), übersteigender Betrag", abovePart, 50, abovePart * GEBAEUDE_KG400_ABOVE_FACTOR);
    }
  }

  return {
    anrechenbareKosten: round2(total),
    sonstigeAnrechenbareKosten: sonstige,
    herleitung,
  };
}

// ── § 50 HOAI (Tragwerksplanung) ──────────────────────────────────────────────
// Anrechenbar sind 55 % der Kosten der Baukonstruktion (KG 300) und 10 % der
// Kosten der Technischen Anlagen (KG 400).
// ⚠️ Sonderfaelle (bestimmte tragwerksrelevante KG-400-Anteile voll,
// mitverarbeitete Bausubstanz im Bestand) sind hier NICHT abgebildet und vor
// produktivem Einsatz zu ergaenzen/verifizieren.
const TRAGWERK_KG300_PCT = 0.55;
const TRAGWERK_KG400_PCT = 0.10;

function anrechenbareKostenTragwerk(estimate) {
  const groups = estimate?.groups || [];
  const kg300 = sumHundred(groups, 300);
  const kg400 = sumHundred(groups, 400);

  const herleitung = [];
  let total = 0;
  const add = (kg, label, basis, ansatz, betrag) => {
    const b = round2(betrag);
    herleitung.push({ kg, label, basis: round2(basis), ansatz, betrag: b });
    total += b;
  };
  if (kg300) add("300", "Baukonstruktionen (55 %)", kg300, 55, kg300 * TRAGWERK_KG300_PCT);
  if (kg400) add("400", "Technische Anlagen (10 %)", kg400, 10, kg400 * TRAGWERK_KG400_PCT);

  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: round2(kg300), herleitung };
}

// ── § 38/§ 40 HOAI (Freianlagen) ──────────────────────────────────────────────
// Kern: Kosten der Außenanlagen (KG 500) sind voll anrechenbar.
// ⚠️ Anteilige Kosten aus KG 200/300, die den Freianlagen zuzurechnen sind,
// sowie technische Anlagen in Außenanlagen (KG 540) sind hier NICHT gesondert
// behandelt und vor produktivem Einsatz zu ergaenzen/verifizieren.
function anrechenbareKostenFreianlagen(estimate) {
  const groups = estimate?.groups || [];
  const kg500 = sumHundred(groups, 500);
  const herleitung = [];
  let total = 0;
  if (kg500) { herleitung.push({ kg: "500", label: "Außenanlagen", basis: round2(kg500), ansatz: 100, betrag: round2(kg500) }); total += round2(kg500); }
  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: round2(kg500), herleitung };
}

// ── § 53/54 HOAI (Technische Ausrüstung) ──────────────────────────────────────
// Das Honorar wird JE ANLAGENGRUPPE getrennt ermittelt (§ 54 Abs. 1). Die
// anrechenbaren Kosten einer Anlagengruppe sind die Kosten der zugehörigen
// KG-400-Untergruppe (410–480), voll (kein 25/50-Cap — der gilt nur für den
// Gebäudeplaner, § 33).
// Dieses Modul rechnet EINE Anlagengruppe (opts.anlagengruppe, z. B. 420);
// das Zusammenfassen mehrerer Anlagengruppen (Mischhonorar, § 54 Abs. 2) ist
// bewusst NICHT abgebildet und als eigene Erweiterung vorgesehen.
// ⚠️ Mitverarbeitete Bausubstanz (KG 400) ist hier NICHT gesondert je
// Anlagengruppe berücksichtigt und vor produktivem Einsatz zu ergänzen.

const ANLAGENGRUPPEN = {
  410: "Abwasser-, Wasser-, Gasanlagen",
  420: "Wärmeversorgungsanlagen",
  430: "Lufttechnische Anlagen",
  440: "Starkstromanlagen",
  450: "Fernmelde- und informationstechnische Anlagen",
  460: "Förderanlagen",
  470: "Nutzungsspezifische und verfahrenstechnische Anlagen",
  480: "Gebäudeautomation",
};

// Zehner-Kostengruppe aus einem KG-Code ("421" → 420, "420" → 420).
function kgTens(kgCode) {
  const n = parseInt(String(kgCode == null ? "" : kgCode).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n / 10) * 10;
}

function anrechenbareKostenTGA(estimate, opts = {}) {
  const agNum = parseInt(String(opts.anlagengruppe == null ? "" : opts.anlagengruppe).replace(/\D/g, ""), 10);
  if (!Number.isFinite(agNum)) {
    throw new Error("Technische Ausrüstung: Anlagengruppe (z. B. 420) erforderlich");
  }
  const agTens = Math.floor(agNum / 10) * 10;
  const groups = estimate?.groups || [];

  const herleitung = [];
  let total = 0;
  for (const g of groups) {
    const code = g.kg ?? g.KG_CODE;
    const n = parseInt(String(code == null ? "" : code).replace(/\D/g, ""), 10);
    if (!Number.isFinite(n) || n < 400 || n >= 500) continue;
    if (kgTens(code) !== agTens) continue;
    const amt = num(g.amount ?? g.AMOUNT);
    if (!amt) continue;
    const b = round2(amt);
    herleitung.push({ kg: String(n), label: g.label ?? g.LABEL ?? "Technische Anlagen", basis: b, ansatz: 100, betrag: b });
    total += b;
  }

  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: round2(total), herleitung };
}

// ── Anlage 1.2 HOAI (Bauphysik) ───────────────────────────────────────────────
// Die drei Teilgebiete haben UNTERSCHIEDLICHE anrechenbare Kosten — ein
// gemeinsamer Regelsatz waere fachlich falsch:
//   1.2.3 Waermeschutz  → anrechenbare Kosten des Gebaeudes gemaess § 33
//   1.2.4 Bauakustik    → KG 300 + KG 400, voll
//   1.2.5 Raumakustik   → je Innenraum, (KG 300 + KG 400) anteilig ueber
//                         Rauminhalt/Bruttorauminhalt, zzgl. KG 610
//
// Anlage 1.2.3 Abs. 1: "richtet sich nach den anrechenbaren Kosten des
// Gebaeudes gemaess § 33 nach der Honorarzone nach § 35". Der Waermeschutz
// erbt damit die Gebaeuderegel einschliesslich der KG-400-25/50-Kappung.
function anrechenbareKostenBauphysikWaerme(estimate) {
  return anrechenbareKostenGebaeude(estimate);
}

// Anlage 1.2.4 Abs. 1: "Fuer Grundleistungen der Bauakustik sind die Kosten
// fuer Baukonstruktionen und Anlagen der Technischen Ausruestung anrechenbar."
// Voll, ohne die 25/50-Kappung des § 33 und ohne Unterscheidung nach
// selbst/fremd geplant — die Kappung gilt nur dem Gebaeudeplaner.
// Satz 2: "Der Umfang der mitzuverarbeitenden Bausubstanz kann angemessen
// beruecksichtigt werden."
function anrechenbareKostenBauphysikBauakustik(estimate) {
  const groups = estimate?.groups || [];
  const bausubstanz = num(estimate?.mitverarbeiteteBausubstanz ?? estimate?.MITVERARBEITETE_BAUSUBSTANZ);
  const kg300 = sumHundred(groups, 300);
  const kg400 = sumHundred(groups, 400);

  const herleitung = [];
  let total = 0;
  const add = (kg, label, basis, ansatz, betrag) => {
    const b = round2(betrag);
    herleitung.push({ kg, label, basis: round2(basis), ansatz, betrag: b });
    total += b;
  };
  if (kg300)       add("300", "Baukonstruktionen", kg300, 100, kg300);
  if (kg400)       add("400", "Technische Ausruestung", kg400, 100, kg400);
  if (bausubstanz) add("—", "Mitverarbeitete Bausubstanz (angemessen)", bausubstanz, 100, bausubstanz);

  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: round2(kg300 + kg400), herleitung };
}

// Anlage 1.2.5 Abs. 1/2: Das Honorar gilt JE INNENRAUM. Anrechenbar sind
// KG 300 + KG 400, geteilt durch den Bruttorauminhalt des Gebaeudes und
// multipliziert mit dem Rauminhalt des Innenraums, zuzueglich der Kosten der
// Ausstattung (KG 610) DES INNENRAUMS.
//
// opts.rauminhalt  Rauminhalt des Innenraums in m³
// opts.bri         Bruttorauminhalt des Gebaeudes in m³
//
// ⚠️ KG 610 wird aus der Kostenermittlung uebernommen. Ist dort das ganze
// Gebaeude erfasst, ist der Wert vor dem Ansatz auf den Innenraum zu
// reduzieren — anteilig herunterrechnen laesst er sich nicht, weil sich
// Ausstattung nicht proportional zum Volumen verteilt.
function anrechenbareKostenBauphysikRaumakustik(estimate, opts = {}) {
  const rauminhalt = num(opts.rauminhalt);
  const bri        = num(opts.bri);
  if (!(rauminhalt > 0) || !(bri > 0)) {
    throw new Error("Raumakustik: Rauminhalt des Innenraums und Bruttorauminhalt des Gebaeudes (m³) erforderlich");
  }
  if (rauminhalt > bri) {
    throw new Error("Raumakustik: Rauminhalt des Innenraums ist groesser als der Bruttorauminhalt des Gebaeudes");
  }

  const groups = estimate?.groups || [];
  const bausubstanz = num(estimate?.mitverarbeiteteBausubstanz ?? estimate?.MITVERARBEITETE_BAUSUBSTANZ);
  const kg300 = sumHundred(groups, 300);
  const kg400 = sumHundred(groups, 400);
  const kg610 = (groups || []).reduce((s, g) => (kgTens(g.kg ?? g.KG_CODE) === 610 ? s + num(g.amount ?? g.AMOUNT) : s), 0);

  const anteil = rauminhalt / bri;
  const ansatzPct = round2(anteil * 100);

  const herleitung = [];
  let total = 0;
  const add = (kg, label, basis, ansatz, betrag) => {
    const b = round2(betrag);
    herleitung.push({ kg, label, basis: round2(basis), ansatz, betrag: b });
    total += b;
  };
  const label = `Anteil Innenraum ${round2(rauminhalt)} m³ / ${round2(bri)} m³`;
  if (kg300)       add("300", `Baukonstruktionen — ${label}`, kg300, ansatzPct, kg300 * anteil);
  if (kg400)       add("400", `Technische Ausruestung — ${label}`, kg400, ansatzPct, kg400 * anteil);
  if (kg610)       add("610", "Ausstattung des Innenraums", kg610, 100, kg610);
  if (bausubstanz) add("—", "Mitverarbeitete Bausubstanz (angemessen)", bausubstanz, 100, bausubstanz);

  return {
    anrechenbareKosten: round2(total),
    sonstigeAnrechenbareKosten: round2((kg300 + kg400) * anteil),
    herleitung,
  };
}

// Registry: Leistungsbild-Typ → Regelfunktion (estimate, opts) → Ergebnis.
const RULES = {
  gebaeude:    anrechenbareKostenGebaeude,
  tragwerk:    anrechenbareKostenTragwerk,
  freianlagen: anrechenbareKostenFreianlagen,
  tga:         anrechenbareKostenTGA,
  bauphysik_waerme:      anrechenbareKostenBauphysikWaerme,
  bauphysik_bauakustik:  anrechenbareKostenBauphysikBauakustik,
  bauphysik_raumakustik: anrechenbareKostenBauphysikRaumakustik,
};

/**
 * Anrechenbare Kosten fuer ein Leistungsbild ableiten.
 * @param {string} leistungsbild  Schluessel in RULES (z. B. 'gebaeude')
 * @param {object} estimate
 */
function anrechenbareKosten(leistungsbild, estimate, opts = {}) {
  const fn = RULES[String(leistungsbild || "").toLowerCase()];
  if (!fn) throw new Error(`Kein Anrechenbarkeits-Regelsatz fuer Leistungsbild "${leistungsbild}"`);
  return fn(estimate, opts);
}

// Zerlegt einen ggf. zusammengesetzten Leistungsbild-Schlüssel:
//   "gebaeude"  → { key: "gebaeude", opts: {} }
//   "tga:420"   → { key: "tga", opts: { anlagengruppe: "420" } }
function parseLeistungsbild(str) {
  const raw = String(str || "").trim();
  const [key, param] = raw.split(":");
  const k = (key || "gebaeude").toLowerCase();
  return { key: k, opts: k === "tga" && param ? { anlagengruppe: param } : {} };
}

module.exports = {
  anrechenbareKostenGebaeude,
  anrechenbareKostenTragwerk,
  anrechenbareKostenFreianlagen,
  anrechenbareKostenTGA,
  anrechenbareKostenBauphysikWaerme,
  anrechenbareKostenBauphysikBauakustik,
  anrechenbareKostenBauphysikRaumakustik,
  anrechenbareKosten,
  parseLeistungsbild,
  kgHundred,
  kgTens,
  ANLAGENGRUPPEN,
  GEBAEUDE_KG400_THRESHOLD_PCT,
  GEBAEUDE_KG400_ABOVE_FACTOR,
  TRAGWERK_KG300_PCT,
  TRAGWERK_KG400_PCT,
};
