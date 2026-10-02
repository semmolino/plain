"use strict";

const { createNotification } = require("./notifications");
const { openAmountsFor, withClaimCols } = require("./openAmount");
const { localDateStr } = require("./notificationSchedule");

const STUFE_LABELS = ['–', 'Zahlungserinnerung', '1. Mahnung', '2. Mahnung', '3. Mahnung'];

/** IDs der Belege, deren offener Betrag erledigt ist (openAmount.js). */
async function settledDocs(supabase, mahnungen) {
  const out = { invoice: new Set(), pp: new Set() };
  try {
    for (const [kind, col, set] of [["INVOICE", "INVOICE_ID", out.invoice], ["ADVANCE_INVOICE", "PP_ID", out.pp]]) {
      const ids = Array.from(new Set(mahnungen.map(m => m[col]).filter(Boolean)));
      if (ids.length === 0) continue;
      const { data: docs, error } = await supabase.from(kind).select(withClaimCols(kind, "ID")).in("ID", ids);
      if (error) throw new Error(error.message);
      const open = await openAmountsFor(supabase, { kind, docs: docs || [] });
      for (const [id, o] of open) if (o.claim.payable > 0 && o.settled) set.add(id);
    }
  } catch (e) {
    // Lieber einmal zu viel erinnern als eine offene Mahnung verschweigen.
    console.error("[MAHNUNG_CHECKER] Offene Betraege nicht ladbar:", e?.message || e);
  }
  return out;
}

async function checkMahnungen(supabase) {
  const today = localDateStr();

  // Find open Mahnungen where NEXT_MAHNUNG_DATE is today or past
  const { data: mahnungen, error } = await supabase
    .from("MAHNUNG")
    .select("ID, TENANT_ID, MAHNSTUFE, NEXT_MAHNUNG_DATE, INVOICE_ID, PP_ID")
    .eq("IS_CLOSED", false)
    .not("NEXT_MAHNUNG_DATE", "is", null)
    .lte("NEXT_MAHNUNG_DATE", today);

  if (error) {
    console.error("[MAHNUNG_CHECKER] Failed to load mahnungen:", error.message);
    return;
  }

  let created = 0;

  // Ist der Beleg inzwischen bezahlt oder der Rest ausgebucht, gibt es nichts
  // mehr zu mahnen — vorher erinnerte der Checker trotzdem an die naechste
  // Stufe, bis jemand die Mahnung von Hand schloss.
  const settled = await settledDocs(supabase, mahnungen || []);

  for (const m of (mahnungen || [])) {
    if ((m.INVOICE_ID && settled.invoice.has(String(m.INVOICE_ID)))
      || (m.PP_ID && settled.pp.has(String(m.PP_ID)))) continue;
    const notifType = `mahnung_due`;
    const mahnungIdStr = String(m.ID);

    // Check if a notification already exists for this mahnung + next_mahnung_date combo
    const { data: existing } = await supabase
      .from("NOTIFICATION")
      .select("ID")
      .eq("TENANT_ID", m.TENANT_ID)
      .eq("TYPE", notifType)
      .eq("METADATA->>mahnung_id", mahnungIdStr)
      .eq("METADATA->>ref_date", m.NEXT_MAHNUNG_DATE)
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Fetch invoice/PP number for the notification title
    let docNumber = `#${m.ID}`;
    if (m.INVOICE_ID) {
      const { data: inv } = await supabase
        .from("INVOICE")
        .select("INVOICE_NUMBER")
        .eq("ID", m.INVOICE_ID)
        .maybeSingle();
      if (inv?.INVOICE_NUMBER) docNumber = inv.INVOICE_NUMBER;
    } else if (m.PP_ID) {
      const { data: pp } = await supabase
        .from("ADVANCE_INVOICE")
        .select("ADVANCE_INVOICE_NUMBER")
        .eq("ID", m.PP_ID)
        .maybeSingle();
      if (pp?.ADVANCE_INVOICE_NUMBER) docNumber = pp.ADVANCE_INVOICE_NUMBER;
    }

    const stufeLabel = STUFE_LABELS[m.MAHNSTUFE] || `Stufe ${m.MAHNSTUFE}`;

    try {
      await createNotification(supabase, {
        tenantId: m.TENANT_ID,
        userId:   null, // tenant-wide
        type:     notifType,
        title:    `Mahnung fällig: ${docNumber}`,
        body:     `${stufeLabel} – Nächste Aktion war fällig am ${m.NEXT_MAHNUNG_DATE}`,
        link:     "/rechnungen?tab=mahnungen",
        metadata: { mahnung_id: mahnungIdStr, ref_date: m.NEXT_MAHNUNG_DATE },
      });
      created++;
    } catch (notifErr) {
      console.error("[MAHNUNG_CHECKER] Could not create notification:", notifErr?.message || notifErr);
    }
  }

  if (created > 0) {
    console.log(`[MAHNUNG_CHECKER] Created ${created} dunning notification(s)`);
  }
}

function startMahnungChecker(supabase) {
  const RUN_AFTER_MS = 90_000;                   // 90 s after boot (after dueDateChecker)
  const INTERVAL_MS  = 24 * 60 * 60 * 1000;     // every 24 h

  setTimeout(async () => {
    console.log("[MAHNUNG_CHECKER] Running initial check …");
    await checkMahnungen(supabase).catch(e =>
      console.error("[MAHNUNG_CHECKER] Error:", e?.message || e)
    );
    setInterval(() => {
      console.log("[MAHNUNG_CHECKER] Running daily check …");
      checkMahnungen(supabase).catch(e =>
        console.error("[MAHNUNG_CHECKER] Error:", e?.message || e)
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

module.exports = { startMahnungChecker };
