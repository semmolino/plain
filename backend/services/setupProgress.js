"use strict";

/**
 * Setup-Progress: aggregiert serverseitig den Status aller Einrichtungs-
 * Schritte. Statt 15 Einzel-Queries im Frontend liefert /setup-progress alles
 * auf einmal.
 *
 * Sections:
 *  - admin   : Tenant-weite Konfiguration (Firmendaten, Logo, Vorbelegungen,
 *              Stammdaten-Tabellen) -- jeder mit settings.* Permission
 *              koennte das erledigen.
 *  - daten   : Erste Datensaetze (Mitarbeiter, Adresse, Angebot, Projekt)
 *              -- jeder aktive User mit den entsprechenden Permissions.
 *
 * Jeder Step liefert:
 *   { key, label, hint, href, done }
 *
 * Alle Checker sind defensiv: bei Schema-Problem -> done=false statt Crash.
 */

async function existsRow(supabase, table, filter) {
  try {
    let q = supabase.from(table).select("ID", { count: "exact", head: true });
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { count, error } = await q;
    if (error) return false;
    return (count || 0) > 0;
  } catch (_) { return false; }
}

async function settingsMap(supabase, tenantId, keys) {
  try {
    const { data, error } = await supabase
      .from("TENANT_SETTINGS")
      .select("KEY, VALUE")
      .eq("TENANT_ID", tenantId)
      .in("KEY", keys);
    if (error) return new Map();
    return new Map((data || []).map(r => [r.KEY, r.VALUE]));
  } catch (_) { return new Map(); }
}

async function computeSetupProgress(supabase, { tenantId, employeeId }) {
  // ── 1) TENANT_SETTINGS-Bulk: alle relevanten Keys auf einmal ──────────────
  const settings = await settingsMap(supabase, tenantId, [
    "logo_asset_id",
    "default_vat_id",
    "default_currency_id",
    "budget_warning_enabled",
    "budget_warning_default_pcts",
    "tenant.hero_asset_id",
  ]);

  // ── 1b) TENANTS.SLUG fuer Login-Branding ─────────────────────────────────
  let hasSlug = false;
  try {
    const { data: tenant } = await supabase
      .from("TENANTS")
      .select("SLUG")
      .eq("ID", tenantId)
      .maybeSingle();
    hasSlug = !!(tenant && tenant.SLUG && String(tenant.SLUG).trim().length > 0);
  } catch (_) { /* TENANTS.SLUG fehlt evtl. -> Migration 0070 nicht gelaufen */ }

  // ── 2) Companies pruefen (Adresse vollstaendig) ──────────────────────────
  let hasCompany = false;
  try {
    const { data } = await supabase
      .from("COMPANY")
      .select("COMPANY_NAME_1, STREET, CITY")
      .eq("TENANT_ID", tenantId);
    hasCompany = (data || []).some(c => c.COMPANY_NAME_1?.trim() && c.STREET?.trim() && c.CITY?.trim());
  } catch (_) {}

  // ── 3) Existenzpruefungen ────────────────────────────────────────────────
  const [
    hasAddress, hasOffer, hasProject, hasAnyEmployee,
    hasWorkingTimeModel, hasMahnungSettings, hasTextTemplate,
    hasNotificationCfg, hasCpRate, hasNonDefaultRoleAssignment,
  ] = await Promise.all([
    existsRow(supabase, "ADDRESS",            { TENANT_ID: tenantId }),
    existsRow(supabase, "OFFER",              { TENANT_ID: tenantId }),
    existsRow(supabase, "PROJECT",            { TENANT_ID: tenantId }),
    (async () => {
      // > 1 Mitarbeiter (Account-Owner zaehlt nicht als "echter" Team-Eintrag)
      try {
        const { count } = await supabase.from("EMPLOYEE").select("ID", { count: "exact", head: true }).eq("TENANT_ID", tenantId);
        return (count || 0) > 1;
      } catch (_) { return false; }
    })(),
    existsRow(supabase, "WORKING_TIME_MODEL", { TENANT_ID: tenantId }),
    existsRow(supabase, "MAHNUNG_SETTINGS",   { TENANT_ID: tenantId }),
    existsRow(supabase, "TEXT_TEMPLATE",      { TENANT_ID: tenantId }),
    existsRow(supabase, "NOTIFICATION_TYPE_CONFIG", { TENANT_ID: tenantId }),
    existsRow(supabase, "EMPLOYEE_CP_RATE",   { TENANT_ID: tenantId }),
    // Rollen-Zuweisung an mind. einen Mitarbeiter (egal welche Rolle)
    (async () => {
      try {
        const { data, error } = await supabase
          .from("EMPLOYEE_ROLE")
          .select("EMPLOYEE_ID")
          .limit(1);
        return !error && (data || []).length > 0;
      } catch (_) { return false; }
    })(),
  ]);

  // ── 4) Nummernkreis-Konfiguration ────────────────────────────────────────
  // Heuristik: existiert eine NUMBER_RANGE-Zeile fuer den Tenant?
  const hasNumberRange = await existsRow(supabase, "NUMBER_RANGE", { TENANT_ID: tenantId });

  const adminSteps = [
    {
      key:  "company_data",
      label:"Firmendaten vervollständigt",
      hint: "Name, Adresse, Steuernummer",
      href: "/admin?tab=unternehmen",
      done: hasCompany,
    },
    {
      key:  "logo",
      label:"Firmenlogo hochgeladen",
      hint: "Wird auf PDFs angezeigt",
      href: "/admin?tab=unternehmen",
      done: !!settings.get("logo_asset_id"),
    },
    {
      key:  "number_ranges",
      label:"Nummernkreise konfiguriert",
      hint: "Rechnungs-, Projekt-, Angebotsnummern",
      href: "/admin?tab=nummernkreise",
      done: hasNumberRange,
    },
    {
      key:  "currency_vat",
      label:"Währung & MwSt.-Satz angelegt",
      hint: "Vorbelegung für Angebote und Rechnungen",
      href: "/admin?tab=vorbelegungen",
      done: !!settings.get("default_vat_id") && !!settings.get("default_currency_id"),
    },
    {
      key:  "budget_warnings",
      label:"Budgetgrenzen definiert",
      hint: "Warnschwellen für Projekt-Budgets",
      href: "/admin?tab=vorbelegungen",
      done: settings.get("budget_warning_enabled") !== "false" && !!settings.get("budget_warning_default_pcts"),
    },
    {
      key:  "notifications",
      label:"Benachrichtigungen eingestellt",
      hint: "Empfänger und Zeitpunkte konfiguriert",
      href: "/admin?tab=benachrichtigungen",
      done: hasNotificationCfg,
    },
    {
      key:  "working_time",
      label:"Arbeitszeitregelungen eingestellt",
      hint: "Wochenstunden, Pausen, Modelle",
      href: "/admin?tab=arbzg",
      done: hasWorkingTimeModel,
    },
    {
      key:  "dunning",
      label:"Mahnungsangaben gespeichert",
      hint: "Mahnstufen, Texte, Gebühren",
      href: "/admin?tab=mahnungseinstellungen",
      done: hasMahnungSettings,
    },
    {
      key:  "text_template",
      label:"Erste Textvorlage gespeichert",
      hint: "Kopf-/Fußtexte für Angebote und Rechnungen",
      href: "/admin?tab=textvorlagen",
      done: hasTextTemplate,
    },
    {
      key:  "roles",
      label:"Berechtigungen geprüft und zugewiesen",
      hint: "Mindestens einem Mitarbeiter eine Rolle gegeben",
      href: "/admin?tab=rollen",
      done: hasNonDefaultRoleAssignment,
    },
    {
      key:  "cost_rate",
      label:"Kostensätze berechnet und übertragen",
      hint: "Pro Mitarbeiter ein Kostensatz hinterlegt",
      href: "/admin?tab=kostensatz",
      done: hasCpRate,
    },
    {
      key:  "branding_slug",
      label:"Login-URL personalisiert",
      hint: "Slug für /login/dein-buero — Mitarbeiter sehen euer Branding",
      href: "/admin?tab=unternehmen",
      done: hasSlug,
    },
    {
      key:  "branding_hero",
      label:"Eigenes Hintergrundbild hinterlegt",
      hint: "Ersetzt das Branchen-Stockfoto auf Dashboard & Login",
      href: "/admin?tab=unternehmen",
      done: !!settings.get("tenant.hero_asset_id"),
    },
  ];

  const datenSteps = [
    {
      key:  "first_employee",
      label:"Erste:n Mitarbeiter:in anlegen",
      hint: "Damit Zeit gebucht werden kann",
      href: "/mitarbeiter",
      done: hasAnyEmployee,
    },
    {
      key:  "first_address",
      label:"Erste Kunden-Adresse erfassen",
      hint: "Grundlage für Angebote & Rechnungen",
      href: "/adressen",
      done: hasAddress,
    },
    {
      key:  "first_offer",
      label:"Erstes Angebot erstellen",
      hint: "Mit HOAI oder pauschal",
      href: "/angebote",
      done: hasOffer,
    },
    {
      key:  "first_project",
      label:"Erstes Projekt anlegen",
      hint: "Aus Angebot oder direkt",
      href: "/projekte",
      done: hasProject,
    },
  ];

  const adminDone   = adminSteps.filter(s => s.done).length;
  const datenDone   = datenSteps.filter(s => s.done).length;
  const totalDone   = adminDone + datenDone;
  const totalCount  = adminSteps.length + datenSteps.length;

  return {
    admin: { steps: adminSteps, done: adminDone, total: adminSteps.length },
    daten: { steps: datenSteps, done: datenDone, total: datenSteps.length },
    total_done:  totalDone,
    total_count: totalCount,
    all_done:    totalDone === totalCount,
  };
}

module.exports = { computeSetupProgress };
