"use strict";

const { createNotification } = require("./notifications");

const STUFE_LABELS = ['–', 'Zahlungserinnerung', '1. Mahnung', '2. Mahnung', '3. Mahnung'];

async function checkMahnungen(supabase) {
  const today = new Date().toISOString().slice(0, 10);

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

  for (const m of (mahnungen || [])) {
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
        .from("PARTIAL_PAYMENT")
        .select("PARTIAL_PAYMENT_NUMBER")
        .eq("ID", m.PP_ID)
        .maybeSingle();
      if (pp?.PARTIAL_PAYMENT_NUMBER) docNumber = pp.PARTIAL_PAYMENT_NUMBER;
    }

    const stufeLabel = STUFE_LABELS[m.MAHNSTUFE] || `Stufe ${m.MAHNSTUFE}`;

    try {
      await createNotification(supabase, {
        tenantId: m.TENANT_ID,
        userId:   null, // tenant-wide
        type:     notifType,
        title:    `Mahnung fällig: ${docNumber}`,
        body:     `${stufeLabel} – Nächste Aktion war fällig am ${m.NEXT_MAHNUNG_DATE}`,
        link:     "/rechnungen",
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
