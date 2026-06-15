# Lizenz-Capability-Katalog (auto-generiert)

> **Nicht von Hand editieren.** Quelle: `backend/licensing/capabilities.manifest.js`.
> Neu erzeugen mit `npm run license:gen --prefix backend`.
> Architektur: [LICENSE_TIERS_CONCEPT.md](LICENSE_TIERS_CONCEPT.md) ·
> Workflow: [LICENSE_DEVELOPMENT_CHECKLIST.md](LICENSE_DEVELOPMENT_CHECKLIST.md).

**Stand:** 2026-06-15 · 11 Module · 42 Capabilities · 90 Permission-Verknüpfungen

> Die Plan↔Capability-Zuordnung liegt in der DB (`PLAN_CAPABILITY`) und wird über die Owner-Konsole gepflegt — sie ist bewusst **nicht** Teil dieses generierten Katalogs.

## Kern `core`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `core.dashboard` | Übersicht / Dashboard | boolean | `dashboard.view`, `dashboard.view_switch` |
| `core.addresses` | Adressbuch & Kontakte | boolean | `addresses.view`, `addresses.create`, `addresses.edit`, `addresses.delete`, `addresses.contacts.view`, `addresses.contacts.create`, `addresses.contacts.edit`, `addresses.contacts.delete` |
| `core.time_tracking` | Stundenerfassung | boolean | `projects.bookings.view`, `projects.bookings.create`, `projects.bookings.edit`, `projects.bookings.delete` |

## Projekte `projects`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `projects.management` | Projektverwaltung & Struktur | boolean | `projects.view`, `projects.create`, `projects.edit`, `projects.delete`, `projects.structure.view`, `projects.structure.edit`, `projects.performance.view`, `projects.performance.edit`, `projects.performance.snapshot` |
| `projects.budgets` | Interne Budgets | boolean | `projects.budget.view`, `projects.budget.edit` |
| `projects.cost_revenue_insight` | Kosten- & Erlös-Einblick | boolean | `projects.bookings.revenue.view`, `projects.bookings.costs.view` |
| `projects.hourly_rates` | Projekt-Stundensätze | boolean | `projects.hourly_rates.view`, `projects.hourly_rates.edit` |
| `projects.contracts` | Verträge | boolean | `projects.contracts.view`, `projects.contracts.edit`, `projects.contracts.delete` |
| `hoai.calculator` | HOAI-Honorarberechnung | boolean | `projects.calculations.view`, `projects.calculations.edit`, `projects.calculations.delete` |

## Rechnungen `invoices`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `invoices.basic` | Rechnungen & Zahlungen (Basis) | boolean | `invoices.view`, `invoices.create_single`, `invoices.edit`, `invoices.delete`, `invoices.book`, `invoices.download_pdf`, `invoices.send_email`, `payments.view`, `payments.create`, `payments.edit`, `payments.delete` |
| `invoices.partial` | Abschlagsrechnungen | boolean | `invoices.create_partial` |
| `invoices.final` | Teil-/Schlussrechnungen | boolean | `invoices.create_final` |
| `invoices.credit` | Gutschriften | boolean | `invoices.create_credit` |
| `invoices.cancel` | Stornierung | boolean | `invoices.cancel` |
| `invoices.security_retention` | Sicherheitseinbehalte | boolean | `security_retention.view` |

## E-Rechnung `einvoice`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `einvoice.xrechnung` | XRechnung (CII/UBL) | boolean | `invoices.download_xml` |
| `einvoice.zugferd` | ZUGFeRD-Hybrid | boolean | — |
| `einvoice.peppol` | Peppol BIS 3.0 | boolean | — |
| `einvoice.attachments` | Anlagen in E-Rechnung einbetten | boolean | — |

## Mahnwesen `dunning`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `dunning.basic` | Mahnungen | boolean | `dunning.view`, `dunning.edit` |
| `dunning.email` | Mahnungen per E-Mail | boolean | `dunning.send` |

## Angebote `offers`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `offers.basic` | Angebote | boolean | `offers.view`, `offers.create`, `offers.edit`, `offers.delete`, `offers.send`, `offers.convert` |

## Reporting `reports`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `reports.standard` | Standard-Reports | boolean | `reports.view` |
| `reports.advanced` | Erweiterte Auswertungen & Export | boolean | `reports.export`, `reports.scope.all` |

## Mitarbeiter `employees`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `employees.management` | Mitarbeiterverwaltung | boolean | `employees.view`, `employees.create`, `employees.edit`, `employees.delete`, `employees.role.assign`, `employees.password.set`, `employees.bookings.view_all` |
| `employees.salary` | Gehaltsdaten | boolean | `employees.salary.view`, `employees.salary.edit` |
| `employees.month_close` | Monatsabschluss | boolean | `employees.month_close.edit`, `settings.monthly_close.edit` |

## Einstellungen `settings`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `settings.core` | Stammdaten, Unternehmen, Nummernkreise | boolean | `settings.basedata.view`, `settings.basedata.edit`, `settings.defaults.edit`, `settings.company.view`, `settings.company.edit`, `settings.numbers.edit` |
| `settings.roles` | Rollen & Berechtigungen (RBAC) | boolean | `roles.view`, `roles.create`, `roles.edit`, `roles.delete` |
| `settings.text_templates` | Textvorlagen | boolean | `settings.text_templates.edit` |
| `settings.notifications` | Konfigurierbare Benachrichtigungen | boolean | `settings.notifications.edit` |
| `settings.dunning_config` | Mahnungs-Einstellungen | boolean | `settings.dunning_config.edit` |
| `cost_rate.calculator` | Kostensatz-Rechner | boolean | `settings.cost_rate.edit` |
| `arbzg.compliance` | ArbZG-Validierung & Audit | boolean | `settings.work_time.edit` |

## Enterprise `enterprise`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `enterprise.multi_company` | Mehrere Unternehmen pro Tenant | boolean | — |
| `enterprise.custom_pdf_templates` | Eigene PDF-Vorlagen | boolean | — |
| `enterprise.api_access` | API-Zugang (Token) | boolean | — |
| `enterprise.sso_saml` | SSO (SAML/OIDC) | boolean | — |
| `enterprise.priority_support` | Priority Support (SLA) | boolean | — |

## Mengen-Limits `limits`

| Capability | Bezeichnung | Typ | Gated Permissions |
|---|---|---|---|
| `limits.employees` | Maximale Mitarbeiterzahl | metered (Mitarbeiter) | — |
| `limits.projects_active` | Maximale aktive Projekte | metered (aktive Projekte) | — |
| `limits.storage_mb` | Speicherplatz | metered (MB) | — |
