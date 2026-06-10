"use strict";

/**
 * Recaps -- aggregierte Statistik fuer einen Zeitraum.
 *
 * Datenbasis: TEC (Buchungen), PROJECT (Projektmanager), INVOICE (Sender),
 * OFFER (Ersteller). Alles strikt persoenlich pro EMPLOYEE_ID.
 *
 *   period = 'week'  -> aktuelle Kalenderwoche (Mo-So)
 *   period = 'month' -> Vormonat
 *   period = 'year'  -> Vorjahr
 *
 * Defensiv: bei Schema-Problem (z.B. fehlende Spalte) wird die jeweilige
 * Kennzahl auf 0 gesetzt, kein Crash.
 */

function isoDay(d) { return d.toISOString().slice(0, 10); }

function dateRangeFor(period, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") {
    // Aktuelle Kalenderwoche, Mo-So
    const dow = today.getUTCDay(); // 0=So..6=Sa
    const offsetToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(today);
    mon.setUTCDate(today.getUTCDate() + offsetToMon);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return { from: isoDay(mon), to: isoDay(sun), label: "Diese Woche" };
  }
  if (period === "month") {
    // Vormonat (kompletter Kalendermonat)
    const firstOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const firstOfLast = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const endOfLast   = new Date(firstOfThis); endOfLast.setUTCDate(endOfLast.getUTCDate() - 1);
    const monthLabels = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
    return {
      from: isoDay(firstOfLast),
      to:   isoDay(endOfLast),
      label: `${monthLabels[firstOfLast.getUTCMonth()]} ${firstOfLast.getUTCFullYear()}`,
    };
  }
  // year -> Vorjahr
  const y = now.getUTCFullYear() - 1;
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` };
}

async function sumTecHours(supabase, { tenantId, employeeId, from, to }) {
  try {
    const { data, error } = await supabase
      .from("TEC")
      .select("QUANTITY_INT")
      .eq("TENANT_ID",   tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .gte("DATE_VOUCHER", from)
      .lte("DATE_VOUCHER", to);
    if (error) return 0;
    let sum = 0;
    for (const r of data || []) {
      const q = Number(r.QUANTITY_INT || 0);
      if (!Number.isNaN(q)) sum += q;
    }
    return Math.round(sum * 100) / 100;
  } catch (_) { return 0; }
}

async function countTec(supabase, { tenantId, employeeId, from, to }) {
  try {
    const { count, error } = await supabase
      .from("TEC")
      .select("ID", { count: "exact", head: true })
      .eq("TENANT_ID",   tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .gte("DATE_VOUCHER", from)
      .lte("DATE_VOUCHER", to);
    if (error) return 0;
    return count || 0;
  } catch (_) { return 0; }
}

async function distinctProjectsTouched(supabase, { tenantId, employeeId, from, to }) {
  try {
    const { data, error } = await supabase
      .from("TEC")
      .select("PROJECT_ID")
      .eq("TENANT_ID",   tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .gte("DATE_VOUCHER", from)
      .lte("DATE_VOUCHER", to);
    if (error) return 0;
    const set = new Set();
    for (const r of data || []) if (r.PROJECT_ID != null) set.add(r.PROJECT_ID);
    return set.size;
  } catch (_) { return 0; }
}

async function countOffers(supabase, { tenantId, employeeId, from, to }) {
  try {
    const { count, error } = await supabase
      .from("OFFER")
      .select("ID", { count: "exact", head: true })
      .eq("TENANT_ID",   tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .gte("OFFER_DATE", from)
      .lte("OFFER_DATE", to);
    if (error) return 0;
    return count || 0;
  } catch (_) { return 0; }
}

async function countInvoices(supabase, { tenantId, employeeId, from, to }) {
  try {
    const { count, error } = await supabase
      .from("INVOICE")
      .select("ID", { count: "exact", head: true })
      .eq("TENANT_ID",   tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .gte("INVOICE_DATE", from)
      .lte("INVOICE_DATE", to);
    if (error) return 0;
    return count || 0;
  } catch (_) { return 0; }
}

async function computeRecap(supabase, { tenantId, employeeId, period }) {
  const { from, to, label } = dateRangeFor(period);
  const [hoursBooked, bookingsCount, projectsCount, offersCount, invoicesCount] = await Promise.all([
    sumTecHours(supabase, { tenantId, employeeId, from, to }),
    countTec(supabase,    { tenantId, employeeId, from, to }),
    distinctProjectsTouched(supabase, { tenantId, employeeId, from, to }),
    countOffers(supabase, { tenantId, employeeId, from, to }),
    countInvoices(supabase, { tenantId, employeeId, from, to }),
  ]);
  return {
    period,
    label,
    from,
    to,
    hours_booked:    hoursBooked,
    bookings_count:  bookingsCount,
    projects_count:  projectsCount,
    offers_count:    offersCount,
    invoices_count:  invoicesCount,
    // Aktivitaets-Score (nice-to-have, 0-100): grobe Zusammenfassung
    activity_score:  Math.min(100, Math.round(
      Math.min(hoursBooked / (period === "week" ? 40 : period === "month" ? 160 : 1800), 1) * 100,
    )),
  };
}

module.exports = { computeRecap };
