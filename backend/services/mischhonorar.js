"use strict";

// TGA-Mischhonorar (§ 54 Abs. 3 HOAI).
//
// Gehören die Anlagen einer Anlagengruppe verschiedenen Honorarzonen an, ist das
// Honorar die Summe gewichteter Einzelhonorare:
//   1. Je Zone das Honorar berechnen, ALS läge die GESAMTE anrechenbare
//      Kostensumme der Anlagengruppe in dieser Zone  → H_voll(z).
//   2. Einzelhonorar(z) = H_voll(z) × AK_z / AK_gesamt.
//   3. Mischhonorar = Σ Einzelhonorare.
// Die Tafel-Degression wirkt so auf die Gesamtsumme (Sinn der Regel).
//
// Reine Rechenlogik: die Tafel-Interpolation wird als Funktion injiziert
// (tafelFn(cost, zoneId, zonePercent) → Grundhonorar), damit die Logik ohne DB
// per Unit-Test gegen Referenzbeispiele abgesichert werden kann.
//
// Konzept: docs/HOAI_MISCHHONORAR_TGA_CONCEPT.md
// ⚠️ § 54 Abs. 3 ist gegen den Gesetzestext zu bestätigen.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num    = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * @param {Array<{ zoneId:number, zonePercent?:number, amount:number }>} splits
 *   Zonenanteile — anrechenbare Kosten je Honorarzone. AK_gesamt = Σ amount.
 * @param {(cost:number, zoneId:number, zonePercent:number)=>number} tafelFn
 *   Grundhonorar (100 %) bei `cost` in `zoneId` (Position `zonePercent`).
 * @returns {{ akGesamt:number, honorar:number, herleitung:Array }}
 */
function computeMischhonorar(splits, tafelFn) {
  const rows = (splits || []).filter((s) => num(s.amount) > 0);
  const akGesamt = round2(rows.reduce((s, r) => s + num(r.amount), 0));
  const herleitung = [];
  if (akGesamt <= 0) return { akGesamt: 0, honorar: 0, herleitung };

  let honorar = 0;
  for (const r of rows) {
    const amount = num(r.amount);
    const zonePercent = num(r.zonePercent);
    const hVoll = num(tafelFn(akGesamt, r.zoneId, zonePercent));
    const anteil = amount / akGesamt;
    const einzel = round2(hVoll * anteil);
    herleitung.push({
      zoneId: r.zoneId,
      zonePercent,
      amount: round2(amount),
      hVoll: round2(hVoll),
      anteilPct: round2(anteil * 100),
      einzelhonorar: einzel,
    });
    honorar += einzel;
  }
  return { akGesamt, honorar: round2(honorar), herleitung };
}

module.exports = { computeMischhonorar };
