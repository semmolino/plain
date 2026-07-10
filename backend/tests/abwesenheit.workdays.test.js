"use strict";

const { workdayCount } = require("../routes/abwesenheit");

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
