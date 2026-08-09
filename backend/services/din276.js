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

// Registry: Leistungsbild-Typ → Regelfunktion. Weitere (Tragwerk §50/51,
// TGA §53, Freianlagen §39/40) folgen in spaeteren Bausteinen.
const RULES = {
  gebaeude: anrechenbareKostenGebaeude,
};

/**
 * Anrechenbare Kosten fuer ein Leistungsbild ableiten.
 * @param {string} leistungsbild  Schluessel in RULES (z. B. 'gebaeude')
 * @param {object} estimate
 */
function anrechenbareKosten(leistungsbild, estimate) {
  const fn = RULES[String(leistungsbild || "").toLowerCase()];
  if (!fn) throw new Error(`Kein Anrechenbarkeits-Regelsatz fuer Leistungsbild "${leistungsbild}"`);
  return fn(estimate);
}

module.exports = {
  anrechenbareKostenGebaeude,
  anrechenbareKosten,
  kgHundred,
  GEBAEUDE_KG400_THRESHOLD_PCT,
  GEBAEUDE_KG400_ABOVE_FACTOR,
};
