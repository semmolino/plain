"use strict";

const { createNotification } = require("./notifications");

// Days before/after due date that trigger a notification
const APPROACHING_DAYS = [7, 3, 1];
const OVERDUE_DAYS     = [1, 7, 14];

function daysBetween(dateA, dateB) {
  return Math.round((dateB - dateA) / (1000 * 60 * 60 * 24));
}

function notifType(kind, days) {
  return `invoice_${kind}_${days}d`;
}

// Check whether a notification for this (type, invoiceId) already exists
async function alreadyNotified(supabase, { tenantId, type, invoiceId }) {
  const { data } = await supabase
    .from("NOTIFICATION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("TYPE", type)
    .eq("METADATA->>invoice_id", String(invoiceId))
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function checkDueDates(supabase) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Load all booked, non-storno invoices with a due date across all tenants
  const { data: invoices, error } = await supabase
    .from("INVOICE")
    .select("ID, TENANT_ID, INVOICE_NUMBER, DUE_DATE")
    .eq("STATUS_ID", 2)
    .neq("INVOICE_TYPE", "stornorechnung")
    .not("DUE_DATE", "is", null);

  if (error) {
    console.error("[DUE_DATE_CHECKER] Failed to load invoices:", error.message);
    return;
  }

  let created = 0;

  for (const inv of invoices || []) {
    const due = new Date(inv.DUE_DATE);
    due.setHours(0, 0, 0, 0);
    const diff = daysBetween(today, due); // positive = future, negative = past

    const label = inv.INVOICE_NUMBER || `#${inv.ID}`;
    const meta  = { invoice_id: String(inv.ID) };
    const link  = `/rechnungen`;

    // Approaching
    for (const days of APPROACHING_DAYS) {
      if (diff === days) {
        const type = notifType("due", days);
        if (await alreadyNotified(supabase, { tenantId: inv.TENANT_ID, type, invoiceId: inv.ID })) continue;
        await createNotification(supabase, {
          tenantId: inv.TENANT_ID,
          userId:   null, // tenant-wide
          type,
          title:    `Rechnung ${label} fällig in ${days} Tag${days > 1 ? "en" : ""}`,
          body:     `Fälligkeitsdatum: ${inv.DUE_DATE.slice(0, 10)}`,
          link,
          metadata: meta,
        });
        created++;
      }
    }

    // Overdue
    for (const days of OVERDUE_DAYS) {
      if (diff === -days) {
        const type = notifType("overdue", days);
        if (await alreadyNotified(supabase, { tenantId: inv.TENANT_ID, type, invoiceId: inv.ID })) continue;
        await createNotification(supabase, {
          tenantId: inv.TENANT_ID,
          userId:   null,
          type,
          title:    `Rechnung ${label} ist ${days} Tag${days > 1 ? "e" : ""} überfällig`,
          body:     `Fälligkeitsdatum war: ${inv.DUE_DATE.slice(0, 10)}`,
          link,
          metadata: meta,
        });
        created++;
      }
    }
  }

  if (created > 0) {
    console.log(`[DUE_DATE_CHECKER] Created ${created} notification(s)`);
  }
}

// Run once at startup (after a short delay), then every 24 hours
function startDueDateChecker(supabase) {
  const RUN_AFTER_MS  = 30_000;          // 30 s after boot
  const INTERVAL_MS   = 24 * 60 * 60 * 1000; // every 24 h

  setTimeout(async () => {
    console.log("[DUE_DATE_CHECKER] Running initial check …");
    await checkDueDates(supabase).catch(e =>
      console.error("[DUE_DATE_CHECKER] Error:", e?.message || e)
    );
    setInterval(() => {
      console.log("[DUE_DATE_CHECKER] Running daily check …");
      checkDueDates(supabase).catch(e =>
        console.error("[DUE_DATE_CHECKER] Error:", e?.message || e)
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

module.exports = { startDueDateChecker };
