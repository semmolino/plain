"use strict";

// Verteilung der Zuschlaege einer HOAI-Kalkulation auf Leistungsphasen und
// Besondere Leistungen (Audit B6: je Zuschlag gerundet, Rest auf den letzten
// Empfaenger). Bis Runde 6 in controllers/stammdaten.js; der Abgleich der
// Angebotselemente (services/feeCalcSync.js) rechnet damit genauso wie der
// Abgleich der Projektstruktur.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Verteilt einen Betrag proportional auf Empfaenger und legt den Rundungsrest
 * auf den letzten Empfaenger. Ohne diesen Ausgleich fehlten Cents: 100,00 EUR
 * auf 3 gleich grosse Leistungsphasen ergaben 3 x 33,33 = 99,99 EUR, waehrend
 * die Zuschlagszeile im PDF 100,00 EUR auswies (Audit B6).
 *
 * Gleiches Vorgehen wie distributeAcrossRemaining in services/partialPayments.js.
 *
 * @param {number} amount   zu verteilender Betrag (bereits auf 2 Stellen)
 * @param {Array<{key: any, weight: number}>} parts  Empfaenger mit Gewicht
 * @returns {Map<any, number>} je Empfaenger ein auf 2 Stellen gerundeter Anteil
 */
function distributeWithRemainder(amount, parts) {
  const out = new Map();
  const eligible = parts.filter(p => p.weight > 0);
  if (!eligible.length) return out;

  const totalWeight = eligible.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return out;

  const target = r2(amount);
  let running = 0;
  eligible.forEach((p, idx) => {
    if (idx === eligible.length - 1) {
      out.set(p.key, r2(target - running));
    } else {
      const share = r2((target * p.weight) / totalWeight);
      out.set(p.key, share);
      running = r2(running + share);
    }
  });
  return out;
}

/**
 * Splits each surcharge's stored AMOUNT proportionally between the LPH phases it
 * targets (via LPH_FILTER) and the BL items it targets (via BL_FILTER).
 * Returns two plain objects: lphAlloc {phaseId → share} and blAlloc {blId → share}.
 *
 * B6: Die Anteile werden je Zuschlag gerundet und mit Restausgleich verteilt.
 * Vorher blieben sie ungerundet und wurden erst je Strukturzeile gerundet --
 * die Summe der Zeilen wich dann um Cents vom ausgewiesenen Zuschlag ab.
 */
function computeSurchargeAllocations(phases, surchargeRows, blItems) {
  const allPhaseIds = (phases || []).map(p => p.ID);
  const lphAlloc = {};
  const blAlloc  = {};

  for (const s of (surchargeRows || [])) {
    const amount = Number(s.AMOUNT) || 0;
    if (amount === 0) continue;

    let selectedLphIds;
    if (s.LPH_FILTER) {
      try { selectedLphIds = JSON.parse(s.LPH_FILTER); } catch { selectedLphIds = allPhaseIds; }
    } else {
      selectedLphIds = allPhaseIds;
    }
    const selectedPhases = (phases || []).filter(p => selectedLphIds.includes(p.ID));
    const lphBase = selectedPhases.reduce((sum, p) => sum + (Number(p.PHASE_REVENUE) || 0), 0);

    let selectedBlItems = [], blBase = 0;
    if (s.BL_FILTER && (blItems || []).length > 0) {
      try {
        const selectedBlIds = JSON.parse(s.BL_FILTER);
        selectedBlItems = (blItems || []).filter(b => b.ID && selectedBlIds.includes(b.ID));
        blBase = selectedBlItems.reduce((sum, b) => sum + (Number(b.AMOUNT) || 0), 0);
      } catch { /* ignore */ }
    }

    const totalBase = lphBase + blBase;
    if (totalBase === 0) continue;

    // Erst die beiden Haelften bilden, und zwar so, dass sie zusammen genau
    // den Zuschlag ergeben -- die zweite ist der Rest der ersten.
    const lphAmt = lphBase > 0 ? r2(r2(amount) * (lphBase / totalBase)) : 0;
    const blAmt  = blBase  > 0 ? r2(r2(amount) - lphAmt)                : 0;

    if (lphBase > 0) {
      const shares = distributeWithRemainder(lphAmt, selectedPhases.map(p => ({
        key: p.ID, weight: Number(p.PHASE_REVENUE) || 0,
      })));
      for (const [phaseId, share] of shares) {
        lphAlloc[phaseId] = r2((lphAlloc[phaseId] || 0) + share);
      }
    }

    if (blBase > 0) {
      const shares = distributeWithRemainder(blAmt, selectedBlItems.map(b => ({
        key: b.ID, weight: Number(b.AMOUNT) || 0,
      })));
      for (const [blId, share] of shares) {
        blAlloc[blId] = r2((blAlloc[blId] || 0) + share);
      }
    }
  }

  return { lphAlloc, blAlloc };
}

/**
 * Werte eines Elements aus einer Kalkulation (Leistungsphase oder Besondere
 * Leistung), gerechnet wie beim Speichern eines Elements: Basis = Honorar der
 * Phase samt Zuschlagsanteil, darauf die EIGENEN Zuschlaege des Elements,
 * NK auf das Honorar inkl. Zuschlaegen. `computeSurcharges` ist
 * computeSurchargesNode (Projekt) bzw. computeSurchargesOffer (Angebot) —
 * beide rechnen gleich, liegen aber je Modul.
 *
 * Vorher setzte „Struktur aktualisieren" nur REVENUE = Phase + Anteil: die
 * eigenen Zuschlaege des Elements fielen weg, und REVENUE_BASIS (das Feld
 * „Honorar" der Tabelle) blieb auf dem alten Stand.
 */
function leafValues(basis, row, computeSurcharges) {
  const b = r2(basis);
  const { s1Eur, s2Eur, s3Eur, surchargesTotal } = computeSurcharges(b, row);
  const revenue = r2(b + surchargesTotal);
  const nk = Number(row?.EXTRAS_PERCENT ?? 0) || 0;
  return {
    REVENUE_BASIS: b, REVENUE: revenue, EXTRAS: r2(revenue * nk / 100),
    SURCHARGES_TOTAL: surchargesTotal,
    SURCHARGE_1_EUR: r2(s1Eur), SURCHARGE_2_EUR: r2(s2Eur), SURCHARGE_3_EUR: r2(s3Eur),
  };
}

module.exports = { computeSurchargeAllocations, distributeWithRemainder, leafValues };
