"use strict";

const { workdayCount, computeVacationBreakdown } = require("../routes/abwesenheit");

// Referenzkalender (2026):
//   Do 2026-01-01 (Neujahr, Feiertag), Fr 01-02, Sa 01-03, So 01-04, Mo 01-05 … Fr 01-09
const NEUJAHR = new Set(["2026-01-01"]);

describe("workdayCount", () => {
  it("zaehlt eine volle Mo–Fr-Woche als 5 Tage", () => {
    expect(workdayCount("2026-01-05", "2026-01-09", false)).toBe(5);
  });

  it("laesst Wochenenden aus", () => {
    // Mo 01-05 bis So 01-11 -> weiterhin 5 Werktage
    expect(workdayCount("2026-01-05", "2026-01-11", false)).toBe(5);
  });

  it("gibt 0 fuer ein reines Wochenende zurueck", () => {
    expect(workdayCount("2026-01-03", "2026-01-04", false)).toBe(0);
  });

  it("zieht einen Feiertag im Zeitraum ab", () => {
    // Mo 2025-12-29 bis Fr 2026-01-02 = 5 Werktage, Neujahr faellt weg -> 4
    expect(workdayCount("2025-12-29", "2026-01-02", false)).toBe(5);
    expect(workdayCount("2025-12-29", "2026-01-02", false, NEUJAHR)).toBe(4);
  });

  it("wertet einen halben Tag an einem Werktag als 0,5", () => {
    expect(workdayCount("2026-01-02", "2026-01-02", true)).toBe(0.5);
  });

  it("wertet einen halben Tag an einem Feiertag/Wochenende als 0", () => {
    expect(workdayCount("2026-01-01", "2026-01-01", true, NEUJAHR)).toBe(0); // Feiertag
    expect(workdayCount("2026-01-03", "2026-01-03", true)).toBe(0);          // Samstag
  });

  it("gibt 0 fuer einen umgekehrten Zeitraum zurueck", () => {
    expect(workdayCount("2026-01-09", "2026-01-05", false)).toBe(0);
  });

  it("gibt 0 fuer ungueltige Datumswerte zurueck", () => {
    expect(workdayCount("nonsense", "2026-01-05", false)).toBe(0);
  });
});

describe("computeVacationBreakdown", () => {
  it("ohne Verfall: Uebertrag fließt ueber die Jahre", () => {
    const { breakdown, current } = computeVacationBreakdown({
      entByYear:   { 2025: { DAYS_ENTITLED: 30 }, 2026: { DAYS_ENTITLED: 30 } },
      takenByYear: { 2025: 20, 2026: 5 },
      minYear: 2025, year: 2026, expires: false,
    });
    expect(breakdown[0].remaining).toBe(10);  // 30 - 20
    expect(current.remaining).toBe(35);       // 10 Uebertrag + 30 - 5
    expect(current.forfeited).toBe(0);
    expect(current.atRisk).toBe(0);
  });

  it("Verfall, Stichtag vorbei: nicht genutzter Uebertrag verfällt", () => {
    const { current } = computeVacationBreakdown({
      entByYear:         { 2026: { DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: 10 } },
      takenByYear:       { 2026: 8 },
      takenBeforeByYear: { 2026: 3 },
      takenAfterByYear:  { 2026: 5 },
      minYear: 2026, year: 2026, expires: true, expiryDate: "03-31",
      todayStr: "2026-06-01",
    });
    expect(current.forfeited).toBe(7);   // 10 Uebertrag - 3 genutzt
    expect(current.atRisk).toBe(0);
    expect(current.remaining).toBe(25);  // 30 - 0 (Anspruch vor Stichtag) - 5 (nach)
  });

  it("Verfall, Stichtag noch offen: Uebertrag ist 'gefährdet', kein Abzug", () => {
    const { current } = computeVacationBreakdown({
      entByYear:         { 2026: { DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: 10 } },
      takenByYear:       { 2026: 2 },
      takenBeforeByYear: { 2026: 2 },
      takenAfterByYear:  { 2026: 0 },
      minYear: 2026, year: 2026, expires: true, expiryDate: "03-31",
      todayStr: "2026-02-01",
    });
    expect(current.forfeited).toBe(0);
    expect(current.atRisk).toBe(8);      // 10 Uebertrag - 2 genutzt
    expect(current.remaining).toBe(38);  // 10 + 30 - 2 (unveraendert bis Stichtag)
  });

  it("Verfall wirkt nicht auf negativen Uebertrag (Schuld bleibt erhalten)", () => {
    const { current } = computeVacationBreakdown({
      entByYear:         { 2026: { DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: -5 } },
      takenByYear:       { 2026: 10 },
      takenBeforeByYear: { 2026: 4 },
      takenAfterByYear:  { 2026: 6 },
      minYear: 2026, year: 2026, expires: true, expiryDate: "03-31",
      todayStr: "2026-06-01",
    });
    expect(current.forfeited).toBe(0);
    expect(current.remaining).toBe(15); // -5 + 30 - 10, wie ohne Verfall
  });
});

// ── Runde 11: nach Arbeitszeitmodell und je Kalenderjahr ────────────────────
const { workdaysByYear, takenVacationByYear } = require("../routes/abwesenheit");

const VOLLZEIT = { MON: 8, TUE: 8, WED: 8, THU: 8, FRI: 8, SAT: 0, SUN: 0 };
const MO_MI    = { MON: 8, TUE: 8, WED: 4, THU: 0, FRI: 0, SAT: 0, SUN: 0 };
const MIT_SA   = { MON: 8, TUE: 8, WED: 8, THU: 8, FRI: 0, SAT: 6, SUN: 0 };

describe("workdayCount nach Arbeitszeitmodell", () => {
  test("Teilzeit Mo–Mi: eine Urlaubswoche kostet 3 Tage, nicht 5", () => {
    expect(workdayCount("2026-01-05", "2026-01-09", false, null, [{ VALID_FROM: "2020-01-01", model: MO_MI }])).toBe(3);
  });
  test("Samstagsarbeit zählt, der freie Freitag nicht", () => {
    expect(workdayCount("2026-01-05", "2026-01-11", false, null, [{ VALID_FROM: "2020-01-01", model: MIT_SA }])).toBe(5);
  });
  test("Modellwechsel mitten im Urlaub: je Tag das dann gültige Modell", () => {
    const assignments = [{ VALID_FROM: "2020-01-01", model: VOLLZEIT }, { VALID_FROM: "2026-01-08", model: MO_MI }];
    // Mo 5. bis Mi 7. Vollzeit (3), Do 8. und Fr 9. Mo–Mi-Modell (0)
    expect(workdayCount("2026-01-05", "2026-01-09", false, null, assignments)).toBe(3);
  });
  test("vor der ersten Zuordnung und ohne Modell: Mo–Fr wie bisher", () => {
    expect(workdayCount("2026-01-05", "2026-01-09", false, null, [{ VALID_FROM: "2027-01-01", model: MO_MI }])).toBe(5);
    expect(workdayCount("2026-01-05", "2026-01-09", false, null, null)).toBe(5);
  });
  test("halber Tag an einem freien Tag des Modells zählt nichts", () => {
    expect(workdayCount("2026-01-08", "2026-01-08", true, null, [{ VALID_FROM: "2020-01-01", model: MO_MI }])).toBe(0);
    expect(workdayCount("2026-01-07", "2026-01-07", true, null, [{ VALID_FROM: "2020-01-01", model: MO_MI }])).toBe(0.5);
  });
});

describe("Urlaub über den Jahreswechsel", () => {
  test("workdaysByYear teilt je Jahr (Neujahr frei)", () => {
    // Mo 28.12.2026 – Fr 08.01.2027: 2026 → 28.–31. (4), 2027 → 4.–8. (5), 1.1. Feiertag
    expect(workdaysByYear("2026-12-28", "2027-01-08", false, new Set(["2027-01-01"]))).toEqual({ 2026: 4, 2027: 5 });
  });
  test("takenVacationByYear bucht anteilig — vorher alles ins Startjahr", () => {
    const r = takenVacationByYear([{ DATE_FROM: "2026-12-28", DATE_TO: "2027-01-08", HALF_DAY: false }], { holidays: new Set(["2027-01-01"]) });
    expect(r.takenByYear).toEqual({ 2026: 4, 2027: 5 });
  });
  test("mit Verfall: der Anteil im neuen Jahr liegt vor dessen Stichtag", () => {
    const r = takenVacationByYear([{ DATE_FROM: "2026-12-28", DATE_TO: "2027-01-08", HALF_DAY: false }],
      { holidays: new Set(["2027-01-01"]), expires: true, expiryDate: "03-31" });
    expect(r.takenBeforeByYear).toEqual({ 2026: 0, 2027: 5 });
    expect(r.takenAfterByYear).toEqual({ 2026: 4, 2027: 0 });
  });
  test("über den Stichtag: vor und nach getrennt", () => {
    const r = takenVacationByYear([{ DATE_FROM: "2027-03-29", DATE_TO: "2027-04-02", HALF_DAY: false }], { expires: true, expiryDate: "03-31" });
    expect(r.takenBeforeByYear[2027]).toBe(3);
    expect(r.takenAfterByYear[2027]).toBe(2);
  });
});
