# Lizenz-Capability-Katalog (auto-generiert)

> **Nicht von Hand editieren.** Quelle: `backend/licensing/capabilities.manifest.js`.
> Neu erzeugen mit `npm run license:gen --prefix backend`.
> Architektur: [LICENSE_TIERS_CONCEPT.md](LICENSE_TIERS_CONCEPT.md) ·
> Workflow: [LICENSE_DEVELOPMENT_CHECKLIST.md](LICENSE_DEVELOPMENT_CHECKLIST.md).

**Stand:** 2026-06-15 · 11 Module · 42 Capabilities · 90 Permission-Verknuepfungen

Jede **Capability** ist ein Schalter, den du je Lizenztyp in der Matrix an/aus stellst.
Die Spalte **Enthaltene Funktionen** zeigt, welche konkreten Aktionen/Ansichten dahinter liegen
(= die zugehoerigen RBAC-Rechte). Ein Strich (eigene Funktion) = Feature ohne separates Recht, greift direkt.

> Die Plan-zu-Capability-Zuordnung selbst liegt in der DB (`PLAN_CAPABILITY`) und wird in der Owner-Konsole gepflegt — bewusst **nicht** Teil dieses generierten Katalogs.

## Kern `core`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Übersicht / Dashboard**<br>`core.dashboard` | boolean | Übersicht sehen; Dashboard-Ansicht wechseln |
| **Adressbuch & Kontakte**<br>`core.addresses` | boolean | Adressen sehen; Adressen anlegen; Adressen bearbeiten; Adressen löschen; Kontakte sehen; Kontakte anlegen; Kontakte bearbeiten; Kontakte löschen |
| **Stundenerfassung**<br>`core.time_tracking` | boolean | Buchungen sehen; Buchungen anlegen; Buchungen bearbeiten; Buchungen löschen |

## Projekte `projects`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Projektverwaltung & Struktur**<br>`projects.management` | boolean | Projekte sehen; Projekte anlegen; Projekte bearbeiten; Projekte löschen; Projektstruktur sehen; Projektstruktur bearbeiten; Leistungsstände sehen; Leistungsstände bearbeiten; Projekt-Snapshot erstellen |
| **Interne Budgets**<br>`projects.budgets` | boolean | Interne Budgets sehen; Interne Budgets bearbeiten |
| **Kosten- & Erlös-Einblick**<br>`projects.cost_revenue_insight` | boolean | Buchungen: Erloese sehen; Buchungen: Kosten sehen |
| **Projekt-Stundensätze**<br>`projects.hourly_rates` | boolean | Stundensätze sehen; Stundensätze bearbeiten |
| **Verträge**<br>`projects.contracts` | boolean | Verträge sehen; Verträge bearbeiten; Verträge löschen |
| **HOAI-Honorarberechnung**<br>`hoai.calculator` | boolean | Kalkulationen sehen; Kalkulationen bearbeiten; Kalkulationen löschen |

## Rechnungen `invoices`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Rechnungen & Zahlungen (Basis)**<br>`invoices.basic` | boolean | Rechnungen sehen; Einzelrechnung anlegen; Rechnungsentwürfe bearbeiten; Rechnungsentwürfe löschen; Rechnungen buchen; Rechnungs-PDF herunterladen; Rechnungen per E-Mail senden; Zahlungen sehen; Zahlungen anlegen; Zahlungen bearbeiten; Zahlungen loeschen |
| **Abschlagsrechnungen**<br>`invoices.partial` | boolean | Abschlagsrechnung anlegen |
| **Teil-/Schlussrechnungen**<br>`invoices.final` | boolean | Teil-/Schlussrechnung anlegen |
| **Gutschriften**<br>`invoices.credit` | boolean | Gutschrift anlegen |
| **Stornierung**<br>`invoices.cancel` | boolean | Rechnungen stornieren |
| **Sicherheitseinbehalte**<br>`invoices.security_retention` | boolean | Sicherheitseinbehalte sehen |

## E-Rechnung `einvoice`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **XRechnung (CII/UBL)**<br>`einvoice.xrechnung` | boolean | E-Rechnungs-XML herunterladen |
| **ZUGFeRD-Hybrid**<br>`einvoice.zugferd` | boolean | — eigene Funktion |
| **Peppol BIS 3.0**<br>`einvoice.peppol` | boolean | — eigene Funktion |
| **Anlagen in E-Rechnung einbetten**<br>`einvoice.attachments` | boolean | — eigene Funktion |

## Mahnwesen `dunning`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Mahnungen**<br>`dunning.basic` | boolean | Mahnungen sehen; Mahnungen bearbeiten |
| **Mahnungen per E-Mail**<br>`dunning.email` | boolean | Mahnungen versenden |

## Angebote `offers`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Angebote**<br>`offers.basic` | boolean | Angebote sehen; Angebote anlegen; Angebote bearbeiten; Angebote löschen; Angebote versenden; Angebot in Projekt umwandeln |

## Reporting `reports`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Standard-Reports**<br>`reports.standard` | boolean | Reporting sehen |
| **Erweiterte Auswertungen & Export**<br>`reports.advanced` | boolean | Reports exportieren; Reporting: alle Projekte |

## Mitarbeiter `employees`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Mitarbeiterverwaltung**<br>`employees.management` | boolean | Mitarbeiter sehen; Mitarbeiter anlegen; Mitarbeiter bearbeiten; Mitarbeiter löschen; Rollen zuweisen; Passwörter setzen; Buchungen aller Mitarbeiter |
| **Gehaltsdaten**<br>`employees.salary` | boolean | Gehalt sehen; Gehalt bearbeiten |
| **Monatsabschluss**<br>`employees.month_close` | boolean | Monatsabschluss bearbeiten; Monatsabschluss-Einstellungen |

## Einstellungen `settings`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Stammdaten, Unternehmen, Nummernkreise**<br>`settings.core` | boolean | Stammdaten sehen; Stammdaten bearbeiten; Vorbelegungen bearbeiten; Unternehmen sehen; Unternehmen bearbeiten; Nummernkreise bearbeiten |
| **Rollen & Berechtigungen (RBAC)**<br>`settings.roles` | boolean | Rollen sehen; Rollen anlegen; Rollen bearbeiten; Rollen löschen |
| **Textvorlagen**<br>`settings.text_templates` | boolean | Textvorlagen bearbeiten |
| **Konfigurierbare Benachrichtigungen**<br>`settings.notifications` | boolean | Benachrichtigungen bearbeiten |
| **Mahnungs-Einstellungen**<br>`settings.dunning_config` | boolean | Mahnungs-Einstellungen |
| **Kostensatz-Rechner**<br>`cost_rate.calculator` | boolean | Kostensatz-Rechner |
| **ArbZG-Validierung & Audit**<br>`arbzg.compliance` | boolean | Arbeitszeit-Einstellungen |

## Enterprise `enterprise`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Mehrere Unternehmen pro Tenant**<br>`enterprise.multi_company` | boolean | — eigene Funktion |
| **Eigene PDF-Vorlagen**<br>`enterprise.custom_pdf_templates` | boolean | — eigene Funktion |
| **API-Zugang (Token)**<br>`enterprise.api_access` | boolean | — eigene Funktion |
| **SSO (SAML/OIDC)**<br>`enterprise.sso_saml` | boolean | — eigene Funktion |
| **Priority Support (SLA)**<br>`enterprise.priority_support` | boolean | — eigene Funktion |

## Mengen-Limits `limits`

| Capability | Typ | Enthaltene Funktionen |
|---|---|---|
| **Maximale Mitarbeiterzahl**<br>`limits.employees` | metered (Mitarbeiter) | — eigene Funktion |
| **Maximale aktive Projekte**<br>`limits.projects_active` | metered (aktive Projekte) | — eigene Funktion |
| **Speicherplatz**<br>`limits.storage_mb` | metered (MB) | — eigene Funktion |
