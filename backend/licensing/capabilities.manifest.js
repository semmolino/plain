"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CAPABILITY-MANIFEST  —  EINZIGE QUELLE DER WAHRHEIT für lizenzierbare Features
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Architektur: docs/LICENSE_TIERS_CONCEPT.md
 *  Workflow:    docs/LICENSE_DEVELOPMENT_CHECKLIST.md
 *
 *  - "modules"      = Oberkategorien (nur UI-Gruppierung im Owner-Tool)
 *  - "capabilities" = feingranulare, lizenzierbare Fähigkeiten (Enforcement-Ebene)
 *
 *  Capability-Felder:
 *    key          'modul.fähigkeit'      eindeutig, stabil (nie umbenennen → neu anlegen)
 *    module       Verweis auf modules[].key
 *    labelDe      sprechendes Label (DE)
 *    type         'boolean' | 'metered'
 *    unit         (nur metered) Einheit für die Anzeige, z. B. 'Mitarbeiter'
 *    permissions  RBAC-Keys, die diese Capability freischaltet. MÜSSEN im
 *                 Katalog (migrations 0062/0063) existieren — der Drift-Check prüft das.
 *                 Leeres Array = Capability ohne eigenes RBAC-Recht (nur Lizenz-Gate).
 *    since        Anlagedatum (Doku/Inbox)
 *
 *  WICHTIG: Plan↔Capability-Zuordnung liegt NICHT hier, sondern in der DB
 *  (PLAN_CAPABILITY), editierbar über die Owner-Konsole ohne Deploy.
 *
 *  Nach Änderungen:  npm run license:gen   (Seed-SQL + Doku regenerieren)
 *                    npm run license:check  (Drift-Check)
 * ════════════════════════════════════════════════════════════════════════════
 */

const SINCE = "2026-06-15";

/** @typedef {{key:string,module:string,labelDe:string,type:'boolean'|'metered',unit?:string,permissions:string[],since:string}} Capability */

const modules = [
  { key: "core", labelDe: "Kern", position: 10 },
  { key: "projects", labelDe: "Projekte", position: 20 },
  { key: "invoices", labelDe: "Rechnungen", position: 30 },
  { key: "einvoice", labelDe: "E-Rechnung", position: 40 },
  { key: "dunning", labelDe: "Mahnwesen", position: 50 },
  { key: "offers", labelDe: "Angebote", position: 60 },
  { key: "reports", labelDe: "Reporting", position: 70 },
  { key: "employees", labelDe: "Mitarbeiter", position: 80 },
  { key: "settings", labelDe: "Einstellungen", position: 90 },
  { key: "enterprise", labelDe: "Enterprise", position: 100 },
  { key: "limits", labelDe: "Mengen-Limits", position: 110 },
];

/** @type {Capability[]} */
const capabilities = [
  // ── Kern ───────────────────────────────────────────────────────────────────
  { key: "core.dashboard", module: "core", labelDe: "Übersicht / Dashboard", type: "boolean",
    permissions: ["dashboard.view", "dashboard.view_switch"], since: SINCE },
  { key: "core.addresses", module: "core", labelDe: "Adressbuch & Kontakte", type: "boolean",
    permissions: ["addresses.view", "addresses.create", "addresses.edit", "addresses.delete",
      "addresses.contacts.view", "addresses.contacts.create", "addresses.contacts.edit", "addresses.contacts.delete"], since: SINCE },
  { key: "core.time_tracking", module: "core", labelDe: "Stundenerfassung", type: "boolean",
    permissions: ["projects.bookings.view", "projects.bookings.create", "projects.bookings.edit", "projects.bookings.delete"], since: SINCE },

  // ── Projekte ─────────────────────────────────────────────────────────────────
  { key: "projects.management", module: "projects", labelDe: "Projektverwaltung & Struktur", type: "boolean",
    permissions: ["projects.view", "projects.create", "projects.edit", "projects.delete",
      "projects.structure.view", "projects.structure.edit",
      "projects.performance.view", "projects.performance.edit", "projects.performance.snapshot"], since: SINCE },
  { key: "projects.budgets", module: "projects", labelDe: "Interne Budgets", type: "boolean",
    permissions: ["projects.budget.view", "projects.budget.edit"], since: SINCE },
  { key: "projects.cost_revenue_insight", module: "projects", labelDe: "Kosten- & Erlös-Einblick", type: "boolean",
    permissions: ["projects.bookings.revenue.view", "projects.bookings.costs.view"], since: SINCE },
  { key: "projects.hourly_rates", module: "projects", labelDe: "Projekt-Stundensätze", type: "boolean",
    permissions: ["projects.hourly_rates.view", "projects.hourly_rates.edit"], since: SINCE },
  { key: "projects.contracts", module: "projects", labelDe: "Verträge", type: "boolean",
    permissions: ["projects.contracts.view", "projects.contracts.edit", "projects.contracts.delete"], since: SINCE },
  { key: "hoai.calculator", module: "projects", labelDe: "HOAI-Honorarberechnung", type: "boolean",
    permissions: ["projects.calculations.view", "projects.calculations.edit", "projects.calculations.delete"], since: SINCE },

  // ── Rechnungen ───────────────────────────────────────────────────────────────
  { key: "invoices.basic", module: "invoices", labelDe: "Rechnungen & Zahlungen (Basis)", type: "boolean",
    permissions: ["invoices.view", "invoices.create_single", "invoices.edit", "invoices.delete",
      "invoices.book", "invoices.download_pdf", "invoices.send_email",
      "payments.view", "payments.create", "payments.edit", "payments.delete"], since: SINCE },
  { key: "invoices.partial", module: "invoices", labelDe: "Abschlagsrechnungen", type: "boolean",
    permissions: ["invoices.create_partial"], since: SINCE },
  { key: "invoices.final", module: "invoices", labelDe: "Teil-/Schlussrechnungen", type: "boolean",
    permissions: ["invoices.create_final"], since: SINCE },
  { key: "invoices.credit", module: "invoices", labelDe: "Gutschriften", type: "boolean",
    permissions: ["invoices.create_credit"], since: SINCE },
  { key: "invoices.cancel", module: "invoices", labelDe: "Stornierung", type: "boolean",
    permissions: ["invoices.cancel"], since: SINCE },
  { key: "invoices.security_retention", module: "invoices", labelDe: "Sicherheitseinbehalte", type: "boolean",
    permissions: ["security_retention.view"], since: SINCE },

  // ── E-Rechnung ───────────────────────────────────────────────────────────────
  { key: "einvoice.xrechnung", module: "einvoice", labelDe: "XRechnung (CII/UBL)", type: "boolean",
    permissions: ["invoices.download_xml"], since: SINCE },
  { key: "einvoice.zugferd", module: "einvoice", labelDe: "ZUGFeRD-Hybrid", type: "boolean",
    permissions: [], since: SINCE },
  { key: "einvoice.peppol", module: "einvoice", labelDe: "Peppol BIS 3.0", type: "boolean",
    permissions: [], since: SINCE },
  { key: "einvoice.attachments", module: "einvoice", labelDe: "Anlagen in E-Rechnung einbetten", type: "boolean",
    permissions: [], since: SINCE },

  // ── Mahnwesen ───────────────────────────────────────────────────────────────
  { key: "dunning.basic", module: "dunning", labelDe: "Mahnungen", type: "boolean",
    permissions: ["dunning.view", "dunning.edit"], since: SINCE },
  { key: "dunning.email", module: "dunning", labelDe: "Mahnungen per E-Mail", type: "boolean",
    permissions: ["dunning.send"], since: SINCE },

  // ── Angebote ─────────────────────────────────────────────────────────────────
  { key: "offers.basic", module: "offers", labelDe: "Angebote", type: "boolean",
    permissions: ["offers.view", "offers.create", "offers.edit", "offers.delete", "offers.send", "offers.convert"], since: SINCE },

  // ── Reporting ───────────────────────────────────────────────────────────────
  { key: "reports.standard", module: "reports", labelDe: "Standard-Reports", type: "boolean",
    permissions: ["reports.view"], since: SINCE },
  { key: "reports.advanced", module: "reports", labelDe: "Erweiterte Auswertungen & Export", type: "boolean",
    permissions: ["reports.export", "reports.scope.all"], since: SINCE },

  // ── Mitarbeiter ──────────────────────────────────────────────────────────────
  { key: "employees.management", module: "employees", labelDe: "Mitarbeiterverwaltung", type: "boolean",
    permissions: ["employees.view", "employees.create", "employees.edit", "employees.delete",
      "employees.role.assign", "employees.password.set", "employees.bookings.view_all"], since: SINCE },
  { key: "employees.salary", module: "employees", labelDe: "Gehaltsdaten", type: "boolean",
    permissions: ["employees.salary.view", "employees.salary.edit"], since: SINCE },
  { key: "employees.month_close", module: "employees", labelDe: "Monatsabschluss", type: "boolean",
    permissions: ["employees.month_close.edit", "settings.monthly_close.edit"], since: SINCE },

  // ── Einstellungen ────────────────────────────────────────────────────────────
  { key: "settings.core", module: "settings", labelDe: "Stammdaten, Unternehmen, Nummernkreise", type: "boolean",
    permissions: ["settings.basedata.view", "settings.basedata.edit", "settings.defaults.edit",
      "settings.company.view", "settings.company.edit", "settings.numbers.edit"], since: SINCE },
  { key: "settings.roles", module: "settings", labelDe: "Rollen & Berechtigungen (RBAC)", type: "boolean",
    permissions: ["roles.view", "roles.create", "roles.edit", "roles.delete"], since: SINCE },
  { key: "settings.text_templates", module: "settings", labelDe: "Textvorlagen", type: "boolean",
    permissions: ["settings.text_templates.edit"], since: SINCE },
  { key: "settings.notifications", module: "settings", labelDe: "Konfigurierbare Benachrichtigungen", type: "boolean",
    permissions: ["settings.notifications.edit"], since: SINCE },
  { key: "settings.dunning_config", module: "settings", labelDe: "Mahnungs-Einstellungen", type: "boolean",
    permissions: ["settings.dunning_config.edit"], since: SINCE },
  { key: "cost_rate.calculator", module: "settings", labelDe: "Kostensatz-Rechner", type: "boolean",
    permissions: ["settings.cost_rate.edit"], since: SINCE },
  { key: "arbzg.compliance", module: "settings", labelDe: "ArbZG-Validierung & Audit", type: "boolean",
    permissions: ["settings.work_time.edit"], since: SINCE },

  // ── Enterprise (noch ohne eigenes RBAC-Recht; reine Lizenz-Gates) ─────────────
  { key: "enterprise.multi_company", module: "enterprise", labelDe: "Mehrere Unternehmen pro Tenant", type: "boolean",
    permissions: [], since: SINCE },
  { key: "enterprise.custom_pdf_templates", module: "enterprise", labelDe: "Eigene PDF-Vorlagen", type: "boolean",
    permissions: [], since: SINCE },
  { key: "enterprise.api_access", module: "enterprise", labelDe: "API-Zugang (Token)", type: "boolean",
    permissions: [], since: SINCE },
  { key: "enterprise.sso_saml", module: "enterprise", labelDe: "SSO (SAML/OIDC)", type: "boolean",
    permissions: [], since: SINCE },
  { key: "enterprise.priority_support", module: "enterprise", labelDe: "Priority Support (SLA)", type: "boolean",
    permissions: [], since: SINCE },

  // ── Mengen-Limits (metered) ──────────────────────────────────────────────────
  { key: "limits.employees", module: "limits", labelDe: "Maximale Mitarbeiterzahl", type: "metered",
    unit: "Mitarbeiter", permissions: [], since: SINCE },
  { key: "limits.projects_active", module: "limits", labelDe: "Maximale aktive Projekte", type: "metered",
    unit: "aktive Projekte", permissions: [], since: SINCE },
  { key: "limits.storage_mb", module: "limits", labelDe: "Speicherplatz", type: "metered",
    unit: "MB", permissions: [], since: SINCE },
];

module.exports = { modules, capabilities, SINCE };
