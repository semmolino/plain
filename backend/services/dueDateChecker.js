"use strict";

const { createNotification } = require("./notifications");
const health = require("./checkerHealth");

// Days before/after due date that trigger a notification
const APPROACHING_DAYS = [7, 3, 1];
const OVERDUE_DAYS     = [1, 7, 14];

function daysBetween(dateA, dateB) {
  return Math.round((dateB - dateA) / (1000 * 60 * 60 * 24));
}

// Konsolidierte Typen (Migration 0055). Die Schwelle wandert ins Metadata-Feld.
const TYPE_DUE     = 'invoice_due';
const TYPE_OVERDUE = 'invoice_overdue';

// Check whether a notification for this (type, invoiceId, days) already exists
async function alreadyNotified(supabase, { tenantId, type, invoiceId, days }) {
  const { data } = await supabase
    .from("NOTIFICATION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("TYPE", type)
    .eq("METADATA->>invoice_id", String(invoiceId))
    .eq("METADATA->>days_offset", String(days))
    .limit(1);
  if (Array.isArray(data) && data.length > 0) return true;

  // Rueckwaerts-Kompatibilitaet: alte Notification-Zeilen mit Legacy-Typ
  // wie 'invoice_due_7d' / 'invoice_overdue_14d'. Wenn so eine schon existiert,
  // nicht erneut feuern.
  const legacyType = `${type}_${days}d`;
  const { data: legacy } = await supabase
    .from("NOTIFICATION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("TYPE", legacyType)
    .eq("METADATA->>invoice_id", String(invoiceId))
    .limit(1);
  return Array.isArray(legacy) && legacy.length > 0;
}

// Summe der Zahlungseingaenge je Rechnung. In Bloecken abgefragt, damit die
// in.(…)-Liste bei vielen Rechnungen nicht die URL sprengt.
async function loadPaidGross(supabase, invoiceIds) {
  const map = {};
  const ids = Array.from(new Set((invoiceIds || []).filter(Boolean)));
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("PAYMENT")
      .select("INVOICE_ID, AMOUNT_PAYED_GROSS")
      .in("INVOICE_ID", slice);
    if (error) {
      console.error("[DUE_DATE_CHECKER] Failed to load payments:", error.message);
      continue;
    }
    for (const p of data || []) {
      const v = parseFloat(String(p.AMOUNT_PAYED_GROSS ?? "0"));
      if (!Number.isFinite(v)) continue;
      map[p.INVOICE_ID] = (map[p.INVOICE_ID] || 0) + v;
    }
  }
  return map;
}

// Brutto-Betrag der Rechnung: bevorzugt der gebuchte Wert, sonst aus Netto +
// USt rekonstruiert (gleiche Reihenfolge wie in services/emailTemplates.js).
function grossOf(inv) {
  if (inv.TOTAL_AMOUNT_GROSS != null) {
    const v = parseFloat(String(inv.TOTAL_AMOUNT_GROSS));
    if (Number.isFinite(v)) return v;
  }
  if (inv.TOTAL_AMOUNT_NET != null) {
    const net = parseFloat(String(inv.TOTAL_AMOUNT_NET));
    if (Number.isFinite(net)) {
      const vat = parseFloat(String(inv.VAT_PERCENT ?? 0));
      return Math.round(net * (1 + (Number.isFinite(vat) ? vat : 0) / 100) * 100) / 100;
    }
  }
  return null;
}

// Vollstaendig bezahlt? Ohne bezifferbaren Brutto-Betrag bewusst NEIN — dann
// lieber einmal zu viel erinnern als eine offene Rechnung verschweigen.
// Halber Cent Toleranz gegen Rundungsreste aus Teilzahlungen.
function isSettled(inv, paidGross) {
  const gross = grossOf(inv);
  if (gross == null || gross <= 0) return false;
  return paidGross >= gross - 0.005;
}

async function checkDueDates(supabase) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Load all booked, non-storno invoices with a due date across all tenants
  const { data: invoices, error } = await supabase
    .from("INVOICE")
    .select("ID, TENANT_ID, INVOICE_NUMBER, DUE_DATE, TOTAL_AMOUNT_GROSS, TOTAL_AMOUNT_NET, VAT_PERCENT")
    .eq("STATUS_ID", 2)
    .neq("INVOICE_TYPE", "stornorechnung")
    .not("DUE_DATE", "is", null);

  if (error) {
    console.error("[DUE_DATE_CHECKER] Failed to load invoices:", error.message);
    // Fehler sichtbar machen: ohne diese Meldung sah ein abgelaufenes Token
    // von aussen genauso aus wie "es gab nichts zu tun".
    health.melde("invoice_due", { fehler: error.message });
    return;
  }

  health.melde("invoice_due", { gesehen: (invoices || []).length });

  // Bezahlte Rechnungen sind weder faellig noch ueberfaellig. INVOICE traegt
  // kein Bezahlt-Kennzeichen — der offene Betrag ergibt sich erst aus den
  // PAYMENT-Zeilen, genau wie in der Rechnungsliste und im Mahnwesen.
  const paidByInvoice = await loadPaidGross(supabase, (invoices || []).map(i => i.ID));

  let created = 0;
  let skippedPaid = 0;

  for (const inv of invoices || []) {
    if (isSettled(inv, paidByInvoice[inv.ID] || 0)) { skippedPaid++; continue; }

    const due = new Date(inv.DUE_DATE);
    due.setHours(0, 0, 0, 0);
    const diff = daysBetween(today, due); // positive = future, negative = past

    const label = inv.INVOICE_NUMBER || `#${inv.ID}`;
    const link  = `/rechnungen`;

    // Approaching
    for (const days of APPROACHING_DAYS) {
      if (diff === days) {
        if (await alreadyNotified(supabase, { tenantId: inv.TENANT_ID, type: TYPE_DUE, invoiceId: inv.ID, days })) continue;
        await createNotification(supabase, {
          tenantId: inv.TENANT_ID,
          userId:   null, // wird vom Gate ggf. ueberschrieben
          type:     TYPE_DUE,
          title:    `Rechnung ${label} fällig in ${days} Tag${days > 1 ? "en" : ""}`,
          body:     `Fälligkeitsdatum: ${inv.DUE_DATE.slice(0, 10)}`,
          link,
          metadata: { invoice_id: String(inv.ID), days_offset: String(days) },
        });
        created++;
      }
    }

    // Overdue
    for (const days of OVERDUE_DAYS) {
      if (diff === -days) {
        if (await alreadyNotified(supabase, { tenantId: inv.TENANT_ID, type: TYPE_OVERDUE, invoiceId: inv.ID, days })) continue;
        await createNotification(supabase, {
          tenantId: inv.TENANT_ID,
          userId:   null,
          type:     TYPE_OVERDUE,
          title:    `Rechnung ${label} ist ${days} Tag${days > 1 ? "e" : ""} überfällig`,
          body:     `Fälligkeitsdatum war: ${inv.DUE_DATE.slice(0, 10)}`,
          link,
          metadata: { invoice_id: String(inv.ID), days_offset: String(days) },
        });
        created++;
      }
    }
  }

  health.melde("invoice_due", { erstellt: created });

  if (created > 0 || skippedPaid > 0) {
    console.log(`[DUE_DATE_CHECKER] Created ${created} notification(s), ${skippedPaid} bezahlte Rechnung(en) uebersprungen`);
  }
}

// Run once at startup (after a short delay), then every 24 hours
function startDueDateChecker(supabase) {
  const RUN_AFTER_MS  = 30_000;          // 30 s after boot
  const INTERVAL_MS   = 24 * 60 * 60 * 1000; // every 24 h

  setTimeout(async () => {
    console.log("[DUE_DATE_CHECKER] Running initial check …");
    await health.laufe("invoice_due", () => checkDueDates(supabase)).catch(e =>
      console.error("[DUE_DATE_CHECKER] Error:", e?.message || e)
    );
    setInterval(() => {
      console.log("[DUE_DATE_CHECKER] Running daily check …");
      health.laufe("invoice_due", () => checkDueDates(supabase)).catch(e =>
        console.error("[DUE_DATE_CHECKER] Error:", e?.message || e)
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

module.exports = { startDueDateChecker, checkDueDates };
