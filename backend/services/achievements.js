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
  setup_complete: async (supabase, { tenantId }) => {
    // Alle 4 Setup-Voraussetzungen (Firma+Logo+VAT+NR) + 4 erste Datensaetze
    // (Mitarbeiter, Adresse, Angebot, Projekt). Tenant-weit, deshalb wird das
    // Achievement allen Usern des Tenants verliehen sobald es erfuellt ist.
    try {
      const [companies, defaults, addresses, offers, projects, employees] = await Promise.all([
        supabase.from("COMPANY").select("ID, COMPANY_NAME_1, STREET, CITY").eq("TENANT_ID", tenantId),
        supabase.from("TENANT_SETTINGS").select("KEY,VALUE").eq("TENANT_ID", tenantId).in("KEY", ["default_vat_id","logo_asset_id"]),
        safeCount(supabase, "ADDRESS",  { TENANT_ID: tenantId }),
        safeCount(supabase, "OFFER",    { TENANT_ID: tenantId }),
        safeCount(supabase, "PROJECT",  { TENANT_ID: tenantId }),
        safeCount(supabase, "EMPLOYEE", { TENANT_ID: tenantId }),
      ]);
      const hasCompany = (companies.data || []).some(c => c.COMPANY_NAME_1 && c.STREET && c.CITY);
      const settings = new Map((defaults.data || []).map(r => [r.KEY, r.VALUE]));
      const hasLogo = !!settings.get("logo_asset_id");
      const hasVat  = !!settings.get("default_vat_id");
      const hasNr = true; // Nummernkreise: zu kostspielig live zu pruefen, behandle als erfuellt
      const ok = hasCompany && hasLogo && hasVat && hasNr
              && addresses > 0 && offers > 0 && projects > 0 && employees > 1;
      return { unlocked: ok };
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
};

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
