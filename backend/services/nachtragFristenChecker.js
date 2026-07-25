"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Nachtrags-Fristen-Checker (Phase N2)
// Erinnert an anstehende/überschrittene Prüf-/Entscheidungsfristen offener
// Nachträge (NACHTRAG.REVIEW_DUE_DATE). Terminale Nachträge (beauftragt,
// abgelehnt, zurückgezogen) werden nicht mehr erinnert. Muster: dueDateChecker.
//
// Der Notification-Typ ist (noch) nicht im NOTIFICATION_TYPE-Katalog registriert
// → createNotification nutzt den Legacy-Pfad (tenant-weit). Für konfigurierbare
// Empfänger später einen Katalog-Eintrag ergänzen.
// ─────────────────────────────────────────────────────────────────────────────

const { createNotification } = require("./notifications");

const APPROACHING_DAYS = [7, 3, 1];
const OVERDUE_DAYS     = [1, 7, 14];
const TERMINAL_CODES   = new Set(["COMMISSIONED", "REJECTED", "WITHDRAWN"]);
const TYPE_DUE     = "nachtrag_review_due";
const TYPE_OVERDUE = "nachtrag_review_overdue";

function daysBetween(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

async function alreadyNotified(supabase, { tenantId, type, nachtragId, days }) {
  const { data } = await supabase
    .from("NOTIFICATION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("TYPE", type)
    .eq("METADATA->>nachtrag_id", String(nachtragId))
    .eq("METADATA->>days_offset", String(days))
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function checkNachtragFristen(supabase) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Terminale Status-IDs (keine Erinnerung mehr)
  const { data: statuses } = await supabase.from("NACHTRAG_STATUS").select("ID, CODE");
  const terminalIds = new Set((statuses || []).filter(s => TERMINAL_CODES.has(s.CODE)).map(s => s.ID));

  const { data: rows, error } = await supabase
    .from("NACHTRAG")
    .select("ID, TENANT_ID, NAME_SHORT, REVIEW_DUE_DATE, NACHTRAG_STATUS_ID")
    .not("REVIEW_DUE_DATE", "is", null);

  if (error) {
    console.error("[NACHTRAG_FRISTEN] Failed to load Nachträge:", error.message);
    return;
  }

  let created = 0;
  for (const n of rows || []) {
    if (terminalIds.has(n.NACHTRAG_STATUS_ID)) continue;

    const due = new Date(n.REVIEW_DUE_DATE);
    due.setHours(0, 0, 0, 0);
    const diff  = daysBetween(today, due); // positiv = Zukunft, negativ = überschritten
    const label = n.NAME_SHORT || `#${n.ID}`;
    const link  = `/nachtraege/${n.ID}`;
    const dateStr = String(n.REVIEW_DUE_DATE).slice(0, 10);

    for (const days of APPROACHING_DAYS) {
      if (diff !== days) continue;
      if (await alreadyNotified(supabase, { tenantId: n.TENANT_ID, type: TYPE_DUE, nachtragId: n.ID, days })) continue;
      await createNotification(supabase, {
        tenantId: n.TENANT_ID, userId: null, type: TYPE_DUE,
        title: `Nachtrag ${label}: Prüffrist in ${days} Tag${days > 1 ? "en" : ""}`,
        body:  `Prüf-/Entscheidungsfrist: ${dateStr}`,
        link,  metadata: { nachtrag_id: String(n.ID), days_offset: String(days) },
      });
      created++;
    }

    for (const days of OVERDUE_DAYS) {
      if (diff !== -days) continue;
      if (await alreadyNotified(supabase, { tenantId: n.TENANT_ID, type: TYPE_OVERDUE, nachtragId: n.ID, days })) continue;
      await createNotification(supabase, {
        tenantId: n.TENANT_ID, userId: null, type: TYPE_OVERDUE,
        title: `Nachtrag ${label}: Prüffrist ${days} Tag${days > 1 ? "e" : ""} überschritten`,
        body:  `Frist war: ${dateStr}`,
        link,  metadata: { nachtrag_id: String(n.ID), days_offset: String(days) },
      });
      created++;
    }
  }

  if (created > 0) console.log(`[NACHTRAG_FRISTEN] Created ${created} notification(s)`);
}

function startNachtragFristenChecker(supabase) {
  const RUN_AFTER_MS = 45_000;               // 45 s nach Boot (nach dueDateChecker)
  const INTERVAL_MS  = 24 * 60 * 60 * 1000;  // täglich

  setTimeout(async () => {
    console.log("[NACHTRAG_FRISTEN] Running initial check …");
    await checkNachtragFristen(supabase).catch(e => console.error("[NACHTRAG_FRISTEN] Error:", e?.message || e));
    setInterval(() => {
      checkNachtragFristen(supabase).catch(e => console.error("[NACHTRAG_FRISTEN] Error:", e?.message || e));
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

module.exports = { startNachtragFristenChecker, checkNachtragFristen };
