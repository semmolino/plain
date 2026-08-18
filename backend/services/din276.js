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
// Die Prozentsaetze haengen von der OBJEKTART ab — das ist kein Detail,
// sondern fast eine Verdoppelung der anrechenbaren Kosten:
//   Abs. 1  Gebaeude und zugehoerige bauliche Anlagen  55 % KG 300 + 10 % KG 400
//   Abs. 3  Ingenieurbauwerke                          90 % KG 300 + 15 % KG 400
// Abs. 2 erlaubt es zusaetzlich, bei GEBAEUDEN mit hohem Anteil an Gruendung
// und Tragkonstruktionen in Textform zu vereinbaren, dass nach Abs. 3
// gerechnet wird — dafuer waehlt man hier ebenfalls 'ingenieurbauwerk'.
//
// ⚠️ NICHT abgebildet: Abs. 4 (Traggeruste bei Ingenieurbauwerken =
// Herstellkosten inkl. Baustelleneinrichtung, bei Mehrfachverwendung der
// Neuwert) und Abs. 5 (weitere Kosten anrechenbar, wenn dafuer Mehrleistungen
// nach § 51 erbracht werden) — beides beruht auf einer Vereinbarung im
// Einzelfall und laesst sich nicht aus der Kostenermittlung ableiten.
// Mitverarbeitete Bausubstanz (§ 4 Abs. 3) wird hier ebenfalls nicht
// angesetzt; sie ist "angemessen zu beruecksichtigen" und in Textform zu
// vereinbaren, also kein aus DIN 276 ableitbarer Wert.
const TRAGWERK_KG300_PCT = 0.55;
const TRAGWERK_KG400_PCT = 0.10;
const TRAGWERK_IB_KG300_PCT = 0.90;
const TRAGWERK_IB_KG400_PCT = 0.15;

/**
 * @param {object} estimate
 * @param {object} opts
 *   opts.objektart  'gebaeude' (Default, § 50 Abs. 1) | 'ingenieurbauwerk' (Abs. 3)
 */
function anrechenbareKostenTragwerk(estimate, opts = {}) {
  const groups = estimate?.groups || [];
  const kg300 = sumHundred(groups, 300);
  const kg400 = sumHundred(groups, 400);

  const istIngenieurbauwerk = String(opts.objektart || "").toLowerCase() === "ingenieurbauwerk";
  const pct300 = istIngenieurbauwerk ? TRAGWERK_IB_KG300_PCT : TRAGWERK_KG300_PCT;
  const pct400 = istIngenieurbauwerk ? TRAGWERK_IB_KG400_PCT : TRAGWERK_KG400_PCT;
  const absatz = istIngenieurbauwerk ? "Abs. 3" : "Abs. 1";

  const herleitung = [];
  let total = 0;
  const add = (kg, label, basis, ansatz, betrag) => {
    const b = round2(betrag);
    herleitung.push({ kg, label, basis: round2(basis), ansatz, betrag: b });
    total += b;
  };
  const p = (x) => Math.round(x * 100);
  if (kg300) add("300", `Baukonstruktionen (${p(pct300)} %, § 50 ${absatz})`, kg300, p(pct300), kg300 * pct300);
  if (kg400) add("400", `Technische Anlagen (${p(pct400)} %, § 50 ${absatz})`, kg400, p(pct400), kg400 * pct400);

  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: round2(kg300), herleitung };
}

// ── § 38/§ 40 HOAI (Freianlagen) ──────────────────────────────────────────────
// § 38 Abs. 1: anrechenbar sind die Kosten fuer Aussenanlagen (KG 500),
// ausdruecklich aber nur, "soweit diese durch den Auftragnehmer geplant oder
// ueberwacht werden". Die selbst/fremd-Unterscheidung ist hier also Teil der
// Norm — fremd geplante Aussenanlagen zaehlen gar nicht mit (anders als bei
// § 33/§ 42/§ 46, wo fremd geplante KG 400 anteilig eingehen).
//
// § 38 Abs. 2 schliesst zusaetzlich aus: die Kosten des Gebaeudes selbst, die
// in § 33 Abs. 3 genannten Kosten (Herrichten, nichtoeffentliche
// Erschliessung, Ausstattung/Kunstwerke) sowie Unter- und Oberbau von
// Fussgaengerbereichen — ausgenommen deren Oberflaechenbefestigung. Da wir
// ausschliesslich KG 500 ansetzen, sind Gebaeude (KG 300), Herrichten
// (KG 200) und Ausstattung (KG 600) bereits ausgeschlossen.
//
// ⚠️ NICHT abgebildet: die Feinunterscheidung innerhalb von Fussgaenger-
// bereichen (Unter-/Oberbau nicht anrechenbar, Oberflaechenbefestigung schon)
// — dafuer muesste die Kostenermittlung unterhalb der KG-500-Ebene aufgeteilt
// werden, was DIN 276 hier nicht hergibt. Solche Anteile sind ggf. als eigene
// Kostengruppen-Zeile zu erfassen und "selbst geplant" abzuwaehlen.
function anrechenbareKostenFreianlagen(estimate) {
  const groups = estimate?.groups || [];
  const kg500self  = sumHundred(groups, 500, isSelf);
  const kg500fremd = sumHundred(groups, 500, (g) => !isSelf(g));

  const herleitung = [];
  let total = 0;
  if (kg500self) {
    herleitung.push({ kg: "500", label: "Außenanlagen (selbst geplant/überwacht)", basis: round2(kg500self), ansatz: 100, betrag: round2(kg500self) });
    total += round2(kg500self);
  }
  if (kg500fremd) {
    // Sichtbar machen, warum der Betrag nicht in der Summe steht — sonst
    // wirkt die Herleitung wie ein Rechenfehler.
    herleitung.push({ kg: "500", label: "Außenanlagen (fremd geplant, § 38 Abs. 1 nicht anrechenbar)", basis: round2(kg500fremd), ansatz: 0, betrag: 0 });
  }
  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: round2(kg500self), herleitung };
}

// ── § 42 HOAI (Ingenieurbauwerke) ─────────────────────────────────────────────
// Kern (Abs. 1–3, strukturell parallel zu § 33 Gebäude):
//  - KG 300 (Baukonstruktion) vollstaendig.
//  - KG 400 (Maschinentechnik/Technische Anlagen) selbst geplant: voll.
//    Fremd geplant: bis 25 % der sonstigen anrechenbaren Kosten voll,
//    darueber zur Haelfte (Abs. 2).
//  - KG 200 (Herrichten/Erschliessen), KG 500 (Aussenanlagen/Leitungen),
//    KG 600 (Ausstattung/Nebenanlagen) NUR soweit selbst geplant/ueberwacht,
//    dann voll (Abs. 3) — anders als bei Gebaeude ist KG 500 hier NICHT
//    grundsaetzlich ausgeschlossen, sondern wie KG 200/600 behandelt.
//  - KG 100, 700: nicht anrechenbar (im Gesetzestext nicht erwaehnt).
// ⚠️ Abs. 3 nennt zusaetzlich "verkehrsregelnde Massnahmen waehrend der
// Bauzeit" — hier der KG-200-Gruppe zugeschlagen (baustellenbezogen), da
// DIN 276 dafuer keine eigene Kostengruppe kennt.
const INGENIEURBAUWERK_KG400_THRESHOLD_PCT = 0.25;
const INGENIEURBAUWERK_KG400_ABOVE_FACTOR  = 0.5;

function anrechenbareKostenIngenieurbauwerke(estimate) {
  const groups = estimate?.groups || [];
  const kg300      = sumHundred(groups, 300);
  const kg200self   = sumHundred(groups, 200, isSelf);
  const kg500self   = sumHundred(groups, 500, isSelf);
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

  if (kg300)    add("300", "Baukonstruktion", kg300, 100, kg300);
  if (kg200self) add("200", "Herrichten/Erschließen (selbst geplant)", kg200self, 100, kg200self);
  if (kg500self) add("500", "Außenanlagen/Leitungen (selbst geplant)", kg500self, 100, kg500self);
  if (kg600self) add("600", "Ausstattung/Nebenanlagen (selbst geplant)", kg600self, 100, kg600self);

  const sonstige = round2(kg300 + kg200self + kg500self + kg600self);

  if (kg400self) add("400", "Maschinentechnik/Technische Anlagen (selbst geplant)", kg400self, 100, kg400self);
  if (kg400fremd > 0) {
    const threshold = round2(sonstige * INGENIEURBAUWERK_KG400_THRESHOLD_PCT);
    const fullPart  = Math.min(kg400fremd, threshold);
    const abovePart = Math.max(0, kg400fremd - threshold);
    add("400", `Technische Anlagen (fremd geplant), bis 25 % v. ${round2(sonstige)}`, fullPart, 100, fullPart);
    if (abovePart > 0) {
      add("400", "Technische Anlagen (fremd geplant), übersteigender Betrag", abovePart, 50, abovePart * INGENIEURBAUWERK_KG400_ABOVE_FACTOR);
    }
  }

  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: sonstige, herleitung };
}

// ── § 46 HOAI (Verkehrsanlagen) ───────────────────────────────────────────────
// Abs. 1–3 sind im Kostenzuschnitt identisch zu § 42 Ingenieurbauwerke: KG 300
// voll, KG 400 selbst/fremd mit derselben 25-/50-%-Schwelle, KG 200/500/600
// nur soweit selbst geplant/ueberwacht. Eigene Regelfunktion (nicht Alias auf
// § 42), weil es sich um zwei unabhaengige Vorschriften handelt, die nur
// zufaellig gleich formuliert sind — anders als bei Geotechnik/Tragwerksplanung
// gibt es hier KEINEN Verweis im Gesetzestext von § 46 auf § 42.
//
// ⚠️ BEWUSST NICHT ABGEBILDET (leistungsphasen-/objektabhaengig, passt nicht
// in dieses Modul, das einen einzelnen K0-Wert liefert statt Werte je LPH):
//  - Abs. 4: Erdarbeiten bis 40 % der sonstigen anrechenbaren Kosten
//    zusaetzlich anrechenbar (nur LPH 1–7 und 9); 10 % der Kosten eines
//    NICHT vom selben AN betreuten Ingenieurbauwerks zusaetzlich anrechenbar.
//  - Abs. 5: Degression bei mehrstreifigen Straßen (85/70/60 %) bzw.
//    mehrgleisigen Bahnanlagen (90 %), ebenfalls nur bestimmte LPH.
// Vor produktivem Einsatz mit einer Fachperson gegenpruefen, ob diese
// Vereinfachung fuer den jeweiligen Anwendungsfall tragbar ist.
const VERKEHRSANLAGEN_KG400_THRESHOLD_PCT = 0.25;
const VERKEHRSANLAGEN_KG400_ABOVE_FACTOR  = 0.5;

function anrechenbareKostenVerkehrsanlagen(estimate) {
  const groups = estimate?.groups || [];
  const kg300      = sumHundred(groups, 300);
  const kg200self   = sumHundred(groups, 200, isSelf);
  const kg500self   = sumHundred(groups, 500, isSelf);
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

  if (kg300)    add("300", "Baukonstruktion", kg300, 100, kg300);
  if (kg200self) add("200", "Herrichten/Erschließen (selbst geplant)", kg200self, 100, kg200self);
  if (kg500self) add("500", "Außenanlagen/Leitungen (selbst geplant)", kg500self, 100, kg500self);
  if (kg600self) add("600", "Ausstattung/Nebenanlagen (selbst geplant)", kg600self, 100, kg600self);

  const sonstige = round2(kg300 + kg200self + kg500self + kg600self);

  if (kg400self) add("400", "Technische Anlagen (selbst geplant)", kg400self, 100, kg400self);
  if (kg400fremd > 0) {
    const threshold = round2(sonstige * VERKEHRSANLAGEN_KG400_THRESHOLD_PCT);
    const fullPart  = Math.min(kg400fremd, threshold);
    const abovePart = Math.max(0, kg400fremd - threshold);
    add("400", `Technische Anlagen (fremd geplant), bis 25 % v. ${round2(sonstige)}`, fullPart, 100, fullPart);
    if (abovePart > 0) {
      add("400", "Technische Anlagen (fremd geplant), übersteigender Betrag", abovePart, 50, abovePart * VERKEHRSANLAGEN_KG400_ABOVE_FACTOR);
    }
  }

  return { anrechenbareKosten: round2(total), sonstigeAnrechenbareKosten: sonstige, herleitung };
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

// Anlage 1.3.2 Abs. 1: "Das Honorar der Grundleistungen richtet sich nach den
// anrechenbaren Kosten der Tragwerksplanung nach § 50 Absatz 1 bis 3 fuer das
// gesamte Objekt aus Bauwerk und Baugrube." Keine eigene Regel — identisch zur
// Tragwerksplanung. Die Baugrube ist in DIN 276-1:2008-12 KG 310, also bereits
// Teil von KG 300; die Tragwerk-Regel deckt "Bauwerk und Baugrube" damit ab.
function anrechenbareKostenGeotechnik(estimate, opts = {}) {
  // Anlage 1.3.2 Abs. 1 verweist ausdruecklich auf "§ 50 Absatz 1 bis 3" —
  // die Objektart-Unterscheidung (Gebaeude 55/10 vs Ingenieurbauwerk 90/15)
  // gilt hier also genauso und wird durchgereicht.
  return anrechenbareKostenTragwerk(estimate, opts);
}

// Registry: Leistungsbild-Typ → Regelfunktion (estimate, opts) → Ergebnis.
const RULES = {
  gebaeude:    anrechenbareKostenGebaeude,
  tragwerk:    anrechenbareKostenTragwerk,
  freianlagen: anrechenbareKostenFreianlagen,
  ingenieurbauwerke: anrechenbareKostenIngenieurbauwerke,
  verkehrsanlagen:   anrechenbareKostenVerkehrsanlagen,
  tga:         anrechenbareKostenTGA,
  bauphysik_waerme:      anrechenbareKostenBauphysikWaerme,
  bauphysik_bauakustik:  anrechenbareKostenBauphysikBauakustik,
  bauphysik_raumakustik: anrechenbareKostenBauphysikRaumakustik,
  geotechnik:            anrechenbareKostenGeotechnik,
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
//   "gebaeude"                    → { key: "gebaeude", opts: {} }
//   "tga:420"                     → { key: "tga",       opts: { anlagengruppe: "420" } }
//   "tragwerk:ingenieurbauwerk"   → { key: "tragwerk",  opts: { objektart: "ingenieurbauwerk" } }
//   "geotechnik:ingenieurbauwerk" → { key: "geotechnik",opts: { objektart: "ingenieurbauwerk" } }
// Der Parameter bedeutet je Leistungsbild etwas anderes; welche Schluessel
// welchen Parameter verstehen, steht in PARAM_BY_KEY.
const PARAM_BY_KEY = {
  tga:        "anlagengruppe",
  tragwerk:   "objektart",
  geotechnik: "objektart",
};

function parseLeistungsbild(str) {
  const raw = String(str || "").trim();
  const [key, param] = raw.split(":");
  const k = (key || "gebaeude").toLowerCase();
  const paramName = PARAM_BY_KEY[k];
  return { key: k, opts: paramName && param ? { [paramName]: param } : {} };
}

module.exports = {
  anrechenbareKostenGebaeude,
  anrechenbareKostenTragwerk,
  anrechenbareKostenFreianlagen,
  anrechenbareKostenIngenieurbauwerke,
  anrechenbareKostenVerkehrsanlagen,
  anrechenbareKostenTGA,
  anrechenbareKostenBauphysikWaerme,
  anrechenbareKostenBauphysikBauakustik,
  anrechenbareKostenBauphysikRaumakustik,
  anrechenbareKostenGeotechnik,
  anrechenbareKosten,
  parseLeistungsbild,
  kgHundred,
  kgTens,
  ANLAGENGRUPPEN,
  GEBAEUDE_KG400_THRESHOLD_PCT,
  GEBAEUDE_KG400_ABOVE_FACTOR,
  TRAGWERK_KG300_PCT,
  TRAGWERK_KG400_PCT,
  TRAGWERK_IB_KG300_PCT,
  TRAGWERK_IB_KG400_PCT,
};
