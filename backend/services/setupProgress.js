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

// Lizenz-Gating: jeder Schritt haengt an einer Capability; fehlt sie der
// Organisation, wird der Schritt ausgeblendet (und zaehlt NICHT mit). null =
// immer sichtbar (Basis-/Eigenprofil-Funktion). hasFeature() unrestricted -> true.
const STEP_CAPABILITY = {
  company_data:     "settings.core",
  logo:             "settings.core",
  number_ranges:    "settings.core",
  currency_vat:     "settings.core",
  budget_warnings:  "projects.budgets",
  notifications:    "settings.notifications",
  working_time:     "arbzg.compliance",
  dunning:          "settings.dunning_config",
  text_template:    "settings.text_templates",
  document_template:"settings.core",
  roles:            "settings.roles",
  custom_role:      "settings.roles",
  departments:      "settings.core",
  cost_rate:        "cost_rate.calculator",
  branding_slug:    "enterprise.branding",
  branding_hero:    "enterprise.branding",
  first_employee:   "employees.management",
  first_address:    "core.addresses",
  first_offer:      "offers.basic",
  first_project:    "projects.management",
  profile_complete: null,
  profile_photo:    null,
};

async function computeSetupProgress(supabase, { tenantId, employeeId, hasFeature }) {
  const has = typeof hasFeature === "function" ? hasFeature : () => true;
  const allow = (s) => { const cap = STEP_CAPABILITY[s.key]; return !cap || has(cap); };
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
    hasNotificationCfg, hasCpRate, hasDepartment, hasCustomRole,
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
    existsRow(supabase, "DEPARTMENT",         { TENANT_ID: tenantId }),
    // Eigene (nicht-System-)Rolle angelegt bzw. angepasst
    existsRow(supabase, "USER_ROLE",          { TENANT_ID: tenantId, IS_SYSTEM: false }),
  ]);

  // ── 3b) Rollen-Zuweisung (tenant-scoped, ueber die Auto-Inhaber-Rolle hinaus)
  // Der Signup weist dem Inhaber automatisch GENAU EINE Rolle (Administrator)
  // zu. "Berechtigungen zugewiesen" gilt daher erst als erledigt, wenn es
  // mind. eine WEITERE Zuweisung gibt (frueher: jede beliebige EMPLOYEE_ROLE-
  // Zeile -> ab Tag 1 faelschlich erledigt).
  let hasRoleAssignment = false;
  try {
    const { data: emps } = await supabase.from("EMPLOYEE").select("ID").eq("TENANT_ID", tenantId);
    const empIds = (emps || []).map(e => e.ID);
    if (empIds.length) {
      const { count } = await supabase
        .from("EMPLOYEE_ROLE")
        .select("EMPLOYEE_ID", { count: "exact", head: true })
        .in("EMPLOYEE_ID", empIds);
      hasRoleAssignment = (count || 0) >= 2;
    }
  } catch (_) {}

  // ── 3c) Arbeitszeit: eigenes Modell ODER gespeicherte ArbZG-Einstellungen ──
  // Der Arbeitszeiten-Tab speichert i.d.R. nur arbzg_*-Settings (kein eigenes
  // WORKING_TIME_MODEL). Beides zaehlt als "eingestellt".
  let hasArbzgSettings = false;
  try {
    const { count } = await supabase
      .from("TENANT_SETTINGS")
      .select("KEY", { count: "exact", head: true })
      .eq("TENANT_ID", tenantId)
      .like("KEY", "arbzg_%");
    hasArbzgSettings = (count || 0) > 0;
  } catch (_) {}
  const hasWorkingTime = hasWorkingTimeModel || hasArbzgSettings;

  // ── 3d) Eigenes Profil + Profilfoto ───────────────────────────────────────
  let ownProfileComplete = false;
  let hasAvatar = false;
  try {
    const { data: me } = await supabase
      .from("EMPLOYEE")
      .select("FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER")
      .eq("ID", employeeId).eq("TENANT_ID", tenantId).maybeSingle();
    if (me) ownProfileComplete = !!(me.FIRST_NAME && me.LAST_NAME && me.MAIL && me.MOBILE && me.PERSONNEL_NUMBER);
  } catch (_) {}
  try {
    // AVATAR_ASSET_ID existiert evtl. noch nicht (Migration 0076).
    const { data: av, error } = await supabase
      .from("EMPLOYEE").select("AVATAR_ASSET_ID").eq("ID", employeeId).maybeSingle();
    if (!error && av) hasAvatar = !!av.AVATAR_ASSET_ID;
  } catch (_) {}

  // ── 4) Logo: global ODER pro Firma (Unternehmen-Tab speichert co_<id>_logo)
  let hasCompanyLogo = false;
  try {
    const { data } = await supabase
      .from("TENANT_SETTINGS").select("KEY, VALUE")
      .eq("TENANT_ID", tenantId).like("KEY", "co_%_logo_asset_id");
    hasCompanyLogo = (data || []).some(r => r.VALUE && String(r.VALUE).trim().length > 0);
  } catch (_) {}
  const hasLogo = !!settings.get("logo_asset_id") || hasCompanyLogo;

  // ── 4b) Nummernkreise: DOCUMENT_NUMBER_RANGE der Firma(en) des Tenants ─────
  let hasNumberRange = false;
  try {
    const { data: comps } = await supabase.from("COMPANY").select("ID").eq("TENANT_ID", tenantId);
    const compIds = (comps || []).map(c => c.ID);
    if (compIds.length) {
      const { count } = await supabase
        .from("DOCUMENT_NUMBER_RANGE")
        .select("COMPANY_ID", { count: "exact", head: true })
        .in("COMPANY_ID", compIds);
      hasNumberRange = (count || 0) > 0;
    }
  } catch (_) {}

  // ── 4b2) Dokumentgestaltung: eine gespeicherte DOCUMENT_TEMPLATE der Firma(en)
  // entsteht erst, wenn der Nutzer im Tab Dokumentvorlagen „Gestaltung speichern"
  // geklickt hat (Branding/Anhänge).
  let hasDocTemplate = false;
  try {
    const { data: comps } = await supabase.from("COMPANY").select("ID").eq("TENANT_ID", tenantId);
    const compIds = (comps || []).map(c => c.ID);
    if (compIds.length) {
      const { count } = await supabase
        .from("DOCUMENT_TEMPLATE")
        .select("ID", { count: "exact", head: true })
        .in("COMPANY_ID", compIds);
      hasDocTemplate = (count || 0) > 0;
    }
  } catch (_) {}

  // ── 4c) Budgetgrenzen: nur erledigt, wenn explizit Schwellen gesetzt ODER
  // Budget-Warnungen bewusst deaktiviert wurden. Frueher kippte der Schritt
  // gemeinsam mit "Waehrung & MwSt.", weil die Vorbelegungen-Seite einen
  // gemeinsamen Speicher-Button hat und Default-Prozente immer mitschrieb.
  const bwPctsVal  = settings.get("budget_warning_default_pcts");
  const bwDisabled = settings.get("budget_warning_enabled") === "false";
  const hasBudget  = bwDisabled || !!(bwPctsVal && String(bwPctsVal).trim().length > 0);

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
      done: hasLogo,
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
      hint: "Warnschwellen für Projekt-Budgets (z. B. 75, 90, 100 %)",
      href: "/admin?tab=vorbelegungen",
      done: hasBudget,
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
      done: hasWorkingTime,
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
      href: "/admin?tab=dokumentvorlagen",
      done: hasTextTemplate,
    },
    {
      key:  "document_template",
      label:"Dokumentgestaltung angepasst",
      hint: "Farbe, Schrift, Logo und Anhänge der PDF-Belege",
      href: "/admin?tab=dokumentvorlagen",
      done: hasDocTemplate,
    },
    {
      key:  "roles",
      label:"Berechtigungen geprüft und zugewiesen",
      hint: "Mindestens einem Mitarbeiter eine Rolle gegeben",
      href: "/admin?tab=rollen",
      done: hasRoleAssignment,
    },
    {
      key:  "custom_role",
      label:"Eigene Rolle angelegt oder angepasst",
      hint: "Über die Standard-Systemrollen hinaus",
      href: "/admin?tab=rollen",
      done: hasCustomRole,
    },
    {
      key:  "departments",
      label:"Abteilung angelegt",
      hint: "Stammdaten für die Mitarbeiter-Zuordnung",
      href: "/admin?tab=stammdaten",
      done: hasDepartment,
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
      hint: "URL für /login/dein-buero — Mitarbeiter sehen euer Branding",
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
    {
      key:  "profile_complete",
      label:"Eigenes Profil vervollständigt",
      hint: "Name, Telefon und Personalnummer hinterlegt",
      href: "/profil",
      done: ownProfileComplete,
    },
    {
      key:  "profile_photo",
      label:"Profilfoto hochgeladen",
      hint: "Erscheint oben rechts neben deinem Namen",
      href: "/profil",
      done: hasAvatar,
    },
  ];

  // Nicht lizenzierte Schritte ausblenden; nur freigeschaltete zaehlen mit.
  const adminVisible = adminSteps.filter(allow);
  const datenVisible = datenSteps.filter(allow);

  const adminDone   = adminVisible.filter(s => s.done).length;
  const datenDone   = datenVisible.filter(s => s.done).length;
  const totalDone   = adminDone + datenDone;
  const totalCount  = adminVisible.length + datenVisible.length;

  return {
    admin: { steps: adminVisible, done: adminDone, total: adminVisible.length },
    daten: { steps: datenVisible, done: datenDone, total: datenVisible.length },
    total_done:  totalDone,
    total_count: totalCount,
    all_done:    totalCount > 0 && totalDone === totalCount,
  };
}

module.exports = { computeSetupProgress };
