"use strict";

/**
 * Generator: Leistung & Fortschritt (PROJECT_PROGRESS + Live-Leistungsstand).
 *
 * - Pauschal-Projekte (BT=1): REVENUE ist das Fixhonorar (Stammdaten). Der
 *   Leistungsstand (Fertigstellungsgrad) wächst über die Laufzeit an monatlichen
 *   Stichtagen von 0 → 100 % (100 % erst, wenn das Projekt laut Timeline
 *   abgeschlossen ist). Das aktualisiert die Live-Spalten in PROJECT_STRUCTURE
 *   und schreibt je Stichtag einen PROJECT_PROGRESS-Snapshot.
 * - Stunden-Projekte (BT=2): REVENUE entsteht aus Buchungen (bereits durch den
 *   Buchungs-Generator gesetzt). Hier werden nur Erlös-Snapshots über die Zeit
 *   geschrieben (kumulierte SP_TOT bis zum Stichtag), damit Reports einen
 *   Verlauf zeigen.
 *
 * Läuft NACH dem Buchungs-Generator.
 */

const { insertProgressSnapshot } = require("../../../services/projectProgress");
const cal = require("../lib/calendar");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// weiches 0..1 (smootherstep) für einen realistischen Fertigstellungsverlauf
function ease(f) {
  const x = Math.max(0, Math.min(1, f));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function stichtage(startISO, endISO, everyDays) {
  const out = [];
  let cur = startISO;
  while (cur < endISO) {
    out.push(cur);
    cur = cal.addDays(cur, everyDays);
  }
  out.push(endISO);
  return out;
}

async function generate({ supabase, md, timeline, cfg, log, apply }) {
  const today = cal.todayISO();
  const stats = { snapshots: 0, bt1Structures: 0, bt2Structures: 0 };

  for (const p of md.projects) {
    const tl = timeline.byProject.get(String(p.ID));
    if (!tl || !p.leaves.length) continue;
    const winEnd = tl.end < today ? tl.end : today;
    const dates = stichtage(tl.start, winEnd, cfg.progress.snapshotEveryDays);
    const totalDays = Math.max(1, cal.diffDays(tl.start, tl.end));

    // Für BT2: alle TEC des Projekts einmal laden und pro Blatt/Datum kumulieren.
    let tecByLeaf = new Map();
    const hasBt2 = p.leaves.some((l) => Number(l.BILLING_TYPE_ID) === 2);
    if (hasBt2 && apply) {
      const { data: tecRows } = await supabase
        .from("TEC")
        .select("STRUCTURE_ID, SP_TOT, DATE_VOUCHER")
        .eq("PROJECT_ID", p.ID);
      for (const r of tecRows || []) {
        const k = String(r.STRUCTURE_ID);
        if (!tecByLeaf.has(k)) tecByLeaf.set(k, []);
        tecByLeaf.get(k).push({ d: r.DATE_VOUCHER, v: Number(r.SP_TOT) || 0 });
      }
    }

    for (const leaf of p.leaves) {
      const bt = Number(leaf.BILLING_TYPE_ID);
      if (bt === 2) stats.bt2Structures++;
      else stats.bt1Structures++;

      let lastPct = 0;
      let lastRevComp = 0;
      let lastExtComp = 0;

      for (const d of dates) {
        const f = cal.diffDays(tl.start, d) / totalDays;
        // 100 % nur, wenn abgeschlossen und am/über Enddatum; sonst gedeckelt bei ~95 %
        let pct = ease(f) * 100;
        if (tl.closed && d >= tl.end) pct = 100;
        else pct = Math.min(pct, 95);

        let row = { TENANT_ID: md.tenantId, STRUCTURE_ID: Number(leaf.ID) };

        if (bt === 2) {
          const cum = (tecByLeaf.get(String(leaf.ID)) || []).reduce((s, x) => (x.d <= d ? s + x.v : s), 0);
          row.REVENUE = round2(cum);
          row.REVENUE_COMPLETION_PERCENT = 100;
          row.REVENUE_COMPLETION = round2(cum);
          lastRevComp = round2(cum);
        } else {
          const rev = Number(leaf.REVENUE) || 0;
          const ext = Number(leaf.EXTRAS) || 0;
          lastPct = round2(pct);
          lastRevComp = round2((rev * pct) / 100);
          lastExtComp = round2((ext * pct) / 100);
          row.REVENUE = rev;
          row.EXTRAS = ext;
          row.REVENUE_COMPLETION_PERCENT = lastPct;
          row.EXTRAS_COMPLETION_PERCENT = lastPct;
          row.REVENUE_COMPLETION = lastRevComp;
          row.EXTRAS_COMPLETION = lastExtComp;
        }

        if (apply) {
          const { error } = await insertProgressSnapshot(supabase, [row]);
          if (error) log(`  ⚠︎ Progress P${p.ID}/${leaf.ID} ${d}: ${error.message}`);
        }
        stats.snapshots++;
      }

      // Live-Leistungsstand für BT1 auf den letzten Stand setzen (UI/Reports lesen PROJECT_STRUCTURE).
      if (bt !== 2 && apply) {
        await supabase
          .from("PROJECT_STRUCTURE")
          .update({
            REVENUE_COMPLETION_PERCENT: lastPct,
            EXTRAS_COMPLETION_PERCENT: lastPct,
            REVENUE_COMPLETION: lastRevComp,
            EXTRAS_COMPLETION: lastExtComp,
          })
          .eq("ID", leaf.ID);
      }
    }
  }

  log(
    `  Leistungsstände: ${stats.snapshots} Snapshots ` +
      `(${stats.bt1Structures} Pauschal-, ${stats.bt2Structures} Stunden-Blätter)`,
  );
  return stats;
}

module.exports = { generate };
