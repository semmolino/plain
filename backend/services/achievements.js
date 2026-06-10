"use strict";

const streakSvc = require("./streaks");

/**
 * Achievements -- Phase 3 Engagement
 *
 * Pro Achievement gibt es einen Checker, der true/false zurueckliefert plus
 * (optional) META mit Kontext-Daten (z.B. erreichter Streak-Wert, Datum).
 *
 * Alle Checks sind STRIKT PERSOENLICH pro EMPLOYEE_ID. Tenant-weite Zaehlungen
 * wie "alle Buchungen aller User" sind absichtlich NICHT in Phase 3 dabei --
 * das verletzt die "strikt privat" Regel des Konzepts.
 *
 * Checker liefern { unlocked: boolean, meta?: object }. Defensiv: bei
 * Schema-/Spalten-Problemen -> unlocked=false, kein Throw.
 */

async function safeCount(supabase, table, filter) {
  try {
    let q = supabase.from(table).select("ID", { count: "exact", head: true });
    for (const [col, val] of Object.entries(filter)) q = q.eq(col, val);
    const { count, error } = await q;
    if (error) return 0;
    return count || 0;
  } catch (_) {
    return 0;
  }
}

const CHECKERS = {
  setup_complete: async (supabase, { tenantId, employeeId }) => {
    // Nutzt das gleiche Aggregat wie die SetupChecklist im Dashboard --
    // ALLE Schritte (Admin + Daten) muessen erledigt sein.
    try {
      const setupSvc = require("./setupProgress");
      const sp = await setupSvc.computeSetupProgress(supabase, { tenantId, employeeId });
      return { unlocked: !!sp.all_done };
    } catch (_) {
      return { unlocked: false };
    }
  },

  first_offer: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "OFFER", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId });
    return { unlocked: c >= 1, meta: { count: c } };
  },

  first_project_managed: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "PROJECT", { TENANT_ID: tenantId, PROJECT_MANAGER_ID: employeeId });
    return { unlocked: c >= 1, meta: { count: c } };
  },

  first_invoice: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "INVOICE", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId });
    return { unlocked: c >= 1, meta: { count: c } };
  },

  bookings_100: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "TEC", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId });
    return { unlocked: c >= 100, meta: { count: c } };
  },

  bookings_1000: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "TEC", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId });
    return { unlocked: c >= 1000, meta: { count: c } };
  },

  projects_10: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "PROJECT", { TENANT_ID: tenantId, PROJECT_MANAGER_ID: employeeId });
    return { unlocked: c >= 10, meta: { count: c } };
  },

  streak_5: async (supabase, { tenantId, employeeId }) => {
    try {
      const s = await streakSvc.calculateStreak(supabase, { tenantId, employeeId });
      const peak = Math.max(s.current_streak, s.longest_streak);
      return { unlocked: peak >= 5, meta: { peak } };
    } catch (_) { return { unlocked: false }; }
  },

  streak_22: async (supabase, { tenantId, employeeId }) => {
    try {
      const s = await streakSvc.calculateStreak(supabase, { tenantId, employeeId });
      const peak = Math.max(s.current_streak, s.longest_streak);
      return { unlocked: peak >= 22, meta: { peak } };
    } catch (_) { return { unlocked: false }; }
  },

  streak_66: async (supabase, { tenantId, employeeId }) => {
    try {
      const s = await streakSvc.calculateStreak(supabase, { tenantId, employeeId });
      const peak = Math.max(s.current_streak, s.longest_streak);
      return { unlocked: peak >= 66, meta: { peak } };
    } catch (_) { return { unlocked: false }; }
  },

  // ── Migration 0067: zusaetzliche Badges ──────────────────────────────────

  first_address: async (supabase, { tenantId }) => {
    const c = await safeCount(supabase, "ADDRESS", { TENANT_ID: tenantId });
    return { unlocked: c >= 1 };
  },

  first_contact: async (supabase, { tenantId }) => {
    const c = await safeCount(supabase, "CONTACT", { TENANT_ID: tenantId });
    return { unlocked: c >= 1 };
  },

  // Existiert ein Projekt mit mindestens einem Strukturelement?
  first_project_with_structure: async (supabase, { tenantId }) => {
    try {
      const { data, error } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("PROJECT_ID")
        .eq("TENANT_ID", tenantId)
        .limit(1);
      if (error) return { unlocked: false };
      return { unlocked: (data || []).length > 0 };
    } catch (_) { return { unlocked: false }; }
  },

  // Erster Mitarbeiter mit allen Pflichtfeldern (ohne den angemeldeten User
  // selbst zu zaehlen waere strenger -- wir setzen "mind. 1 Mitarbeiter neben
  // dem Konto-Owner mit kompletten Pflichtfeldern").
  first_employee_complete: async (supabase, { tenantId, employeeId }) => {
    try {
      const { data, error } = await supabase
        .from("EMPLOYEE")
        .select("ID, FIRST_NAME, LAST_NAME, MAIL, PERSONNEL_NUMBER")
        .eq("TENANT_ID", tenantId)
        .neq("ID", employeeId);
      if (error) return { unlocked: false };
      const ok = (data || []).some(e =>
        e.FIRST_NAME && e.LAST_NAME && e.MAIL && e.PERSONNEL_NUMBER
      );
      return { unlocked: ok };
    } catch (_) { return { unlocked: false }; }
  },

  // Erste eigene Buchung
  first_booking: async (supabase, { tenantId, employeeId }) => {
    const c = await safeCount(supabase, "TEC", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId });
    return { unlocked: c >= 1, meta: { count: c } };
  },

  // Erster Leistungsstand mit Fortschritt > 0 in einem Projekt, das der
  // User als PM betreut. Wenn der User keine PM-Projekte hat -> nicht
  // erfuellbar (sinnvoll: Mitarbeiter ohne PM-Rolle bekommen das nicht).
  first_performance_update: async (supabase, { tenantId, employeeId }) => {
    try {
      const { data: projs, error: pErr } = await supabase
        .from("PROJECT")
        .select("ID")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_MANAGER_ID", employeeId);
      if (pErr) return { unlocked: false };
      const projIds = (projs || []).map(p => p.ID);
      if (projIds.length === 0) return { unlocked: false };
      const { data: structs, error: sErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT")
        .in("PROJECT_ID", projIds);
      if (sErr) return { unlocked: false };
      const ok = (structs || []).some(s =>
        Number(s.REVENUE_COMPLETION_PERCENT || 0) > 0 ||
        Number(s.EXTRAS_COMPLETION_PERCENT  || 0) > 0
      );
      return { unlocked: ok };
    } catch (_) { return { unlocked: false }; }
  },

  // Eigenes EMPLOYEE-Profil vollstaendig
  profile_complete: async (supabase, { tenantId, employeeId }) => {
    try {
      const { data, error } = await supabase
        .from("EMPLOYEE")
        .select("FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER")
        .eq("ID", employeeId)
        .eq("TENANT_ID", tenantId)
        .maybeSingle();
      if (error || !data) return { unlocked: false };
      const ok = !!(data.FIRST_NAME && data.LAST_NAME && data.MAIL && data.MOBILE && data.PERSONNEL_NUMBER);
      return { unlocked: ok };
    } catch (_) { return { unlocked: false }; }
  },

  // Erstes konvertiertes Angebot (PROJECT_ID gesetzt)
  offer_commissioned: async (supabase, { tenantId, employeeId }) => {
    try {
      const { data, error } = await supabase
        .from("OFFER")
        .select("ID")
        .eq("TENANT_ID",   tenantId)
        .eq("EMPLOYEE_ID", employeeId)
        .not("PROJECT_ID", "is", null)
        .limit(1);
      if (error) return { unlocked: false };
      return { unlocked: (data || []).length > 0 };
    } catch (_) { return { unlocked: false }; }
  },

  // 5 distinkte Mo-Fr Buchungstage innerhalb einer ISO-Kalenderwoche
  complete_work_week: async (supabase, { tenantId, employeeId }) => {
    try {
      // Letzte 365 Tage sind genug -- wer das in einem Jahr nicht geschafft
      // hat, hat es nicht verdient
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 365);
      const sinceStr = since.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("TEC")
        .select("DATE_VOUCHER")
        .eq("TENANT_ID",   tenantId)
        .eq("EMPLOYEE_ID", employeeId)
        .gte("DATE_VOUCHER", sinceStr);
      if (error) return { unlocked: false };

      // Pro Woche distinkte Mo-Fr Tage zaehlen
      const weekMap = new Map(); // "YYYY-WW" -> Set<day-string>
      for (const r of data || []) {
        if (!r.DATE_VOUCHER) continue;
        const d = new Date(r.DATE_VOUCHER + "T00:00:00Z");
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue;     // nur Mo-Fr
        const wKey = isoWeekKey(d);
        if (!weekMap.has(wKey)) weekMap.set(wKey, new Set());
        weekMap.get(wKey).add(r.DATE_VOUCHER);
      }
      const ok = [...weekMap.values()].some(s => s.size >= 5);
      return { unlocked: ok };
    } catch (_) { return { unlocked: false }; }
  },

  monthly_close_submitted: async (supabase, { tenantId, employeeId }) => {
    try {
      const { count, error } = await supabase
        .from("EMPLOYEE_MONTH_CLOSE")
        .select("ID", { count: "exact", head: true })
        .eq("TENANT_ID",   tenantId)
        .eq("EMPLOYEE_ID", employeeId);
      if (error) return { unlocked: false };
      return { unlocked: (count || 0) >= 1 };
    } catch (_) { return { unlocked: false }; }
  },

  // Saubere Buchhaltung: in den letzten 90 Tagen KEINE Rechnung, die laenger
  // als 30 Tage ueberfaellig war (gilt tenant-weit, vergeben an User mit
  // mind. 1 selbst erstellten Rechnung -- "Buchhaltungs-Beteiligung").
  clean_dunning_3_months: async (supabase, { tenantId, employeeId }) => {
    try {
      // 1) Hat der User selbst mit Rechnungen zu tun?
      const own = await safeCount(supabase, "INVOICE", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId });
      if (own === 0) return { unlocked: false };

      // 2) Gab es in den letzten 90 Tagen eine offene Rechnung > 30 Tage
      // ueberfaellig im Tenant?
      const today = new Date();
      const ninetyAgo = new Date(today);
      ninetyAgo.setUTCDate(ninetyAgo.getUTCDate() - 90);

      const { data, error } = await supabase
        .from("INVOICE")
        .select("DUE_DATE, STATUS_ID, INVOICE_DATE")
        .eq("TENANT_ID", tenantId)
        .gte("INVOICE_DATE", ninetyAgo.toISOString().slice(0, 10));
      if (error) return { unlocked: false };

      // Eine Rechnung galt als "> 30 Tage ueberfaellig", wenn DUE_DATE +30
      // < heutigem Datum UND (STATUS != bezahlt). Wir kennen die genauen
      // Status-IDs nicht zur Compile-Zeit -- pruefen defensiv: STATUS_ID
      // ungleich 3 (=bezahlt im Default) wird als offen behandelt.
      const PAID_STATUS = 3;
      const cutoffMs = today.getTime() - 30 * 86400000;
      const bad = (data || []).some(inv => {
        if (!inv.DUE_DATE) return false;
        if (inv.STATUS_ID === PAID_STATUS) return false;
        return new Date(inv.DUE_DATE).getTime() < cutoffMs;
      });
      return { unlocked: !bad };
    } catch (_) { return { unlocked: false }; }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function isoWeekKey(d) {
  // ISO 8601: KW startet am Montag, Woche 1 enthaelt den 4. Januar
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = date.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diff / (7 * 86400000));
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

/** Liest den vollstaendigen Katalog. */
async function fetchCatalog(supabase) {
  const { data, error } = await supabase
    .from("ACHIEVEMENT")
    .select("KEY, TITLE, DESCRIPTION, CATEGORY, POSITION")
    .eq("ACTIVE", true)
    .order("POSITION", { ascending: true });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

/** Bereits erhaltene Achievements des Users. */
async function fetchEarned(supabase, { tenantId, employeeId }) {
  const { data, error } = await supabase
    .from("USER_ACHIEVEMENT")
    .select("ACHIEVEMENT_KEY, EARNED_AT, META")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

/** Persistiert ein neu erfuelltes Achievement (idempotent). */
async function persistUnlock(supabase, { tenantId, employeeId, key, meta }) {
  const { error } = await supabase
    .from("USER_ACHIEVEMENT")
    .upsert({
      TENANT_ID:       tenantId,
      EMPLOYEE_ID:     employeeId,
      ACHIEVEMENT_KEY: key,
      META:            meta || null,
      EARNED_AT:       new Date().toISOString(),
    }, { onConflict: "TENANT_ID,EMPLOYEE_ID,ACHIEVEMENT_KEY", ignoreDuplicates: true });
  if (error) throw { status: 500, message: error.message };
}

/**
 * Bewertet alle Checker und persistiert neu erreichte Achievements. Liefert
 * den kombinierten Stand (Katalog + earned-Flag + META) zurueck.
 */
async function evaluateAndList(supabase, { tenantId, employeeId }) {
  const [catalog, earnedRows] = await Promise.all([
    fetchCatalog(supabase),
    fetchEarned(supabase, { tenantId, employeeId }),
  ]);
  const earnedMap = new Map(earnedRows.map(r => [r.ACHIEVEMENT_KEY, r]));

  const newlyUnlocked = [];
  for (const a of catalog) {
    if (earnedMap.has(a.KEY)) continue;          // schon erhalten
    const checker = CHECKERS[a.KEY];
    if (!checker) continue;                       // Achievement im Katalog aber kein Checker -> Skip
    const result = await checker(supabase, { tenantId, employeeId });
    if (result?.unlocked) {
      try {
        await persistUnlock(supabase, { tenantId, employeeId, key: a.KEY, meta: result.meta });
        newlyUnlocked.push(a.KEY);
        earnedMap.set(a.KEY, { ACHIEVEMENT_KEY: a.KEY, EARNED_AT: new Date().toISOString(), META: result.meta || null });
      } catch (_) { /* schlucken, ist nicht-blockierend */ }
    }
  }

  // Kombinierte Antwort
  const items = catalog.map(a => {
    const e = earnedMap.get(a.KEY);
    return {
      key:         a.KEY,
      title:       a.TITLE,
      description: a.DESCRIPTION,
      category:    a.CATEGORY,
      position:    a.POSITION,
      earned:      !!e,
      earned_at:   e?.EARNED_AT || null,
      meta:        e?.META || null,
    };
  });

  return {
    items,
    earned_count:  items.filter(i => i.earned).length,
    total_count:   items.length,
    newly_unlocked: newlyUnlocked,
  };
}

module.exports = { evaluateAndList };
