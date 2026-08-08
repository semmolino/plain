# Businessplan-Zulieferung — plan&simple

> Stand: 03.08.2026 · Quellen: Code-Stand des Repositorys (688 Commits, Stand 27.07.2026),
> `docs/GTM_Strategie_plan_and_simple.md`, `docs/LICENSE_TIERS_CONCEPT.md`, `docs/LICENSE_CAPABILITIES.md`,
> `docs/DATA_IMPORT_CONCEPT.md`, `docs/NACHTRAG_CONCEPT.md`, `CLAUDE.md`.
> Alle Zahlen zum Produktstand sind aus dem Repository gemessen, nicht geschätzt.
> Mit **[ergänzen]** markierte Stellen sind persönliche Angaben, die nur der Gründer liefern kann.

---

# TEIL A — Personen & Unternehmen

## A1 Stärken (interne Vorteile: Team, Technologie, Vorsprung)

### A1.1 Produkt- und Technologievorsprung — belegbar in Zahlen

Das Produkt ist kein Konzept, sondern eine lauffähige, deployte Anwendung. Stand 03.08.2026:

| Kennzahl | Wert |
|---|---|
| Entwicklungsbeginn | 16.02.2026 |
| Commits | 688 |
| Codebasis gesamt | ~86.000 Zeilen (Backend ~42.000 / Frontend ~44.000) |
| Backend-Dateien | 150 JS-Dateien (36 Fachdomänen-Router, 44 Services) |
| Frontend-Dateien | 156 TypeScript-/React-Dateien |
| Datenbank | 68 Tabellen, 119 versionierte SQL-Migrationen |
| Funktionskatalog | 12 Module, 43 lizenzierbare Capabilities, 98 Rechte-Verknüpfungen |
| Automatisierte Tests | Backend Jest (13 Testsuites), Frontend Vitest + Playwright E2E |
| Betriebsstatus | produktiv deployt (Railway), Auto-Deploy aus `main` |

**Kernaussage für den Businessplan:** In rund fünfeinhalb Monaten ist ein Funktionsumfang entstanden,
für den in klassischer Aufstellung ein Team von 3–5 Entwicklern etwa 18–24 Personenmonate benötigt hätte.
Der Grund ist konsequenter KI-gestützter Entwicklungsbetrieb (Claude Code) bei gleichzeitig
durchgehaltener Architekturdisziplin — kein Prototyp-Wildwuchs, sondern versionierte Migrationen,
Schichtentrennung Route → Controller → Service, typisiertes Frontend, Testsuite und dokumentierte Konzepte.

### A1.2 Funktionale Vollständigkeit — der Vorsprung ist die Breite

Bereits produktiv verfügbar (nicht geplant, sondern implementiert):

- **Stammdaten & CRM:** Adressbuch mit Kategorien, Kommunikationsdaten, Steuerdaten, Notizen; 360°-Detailansicht je Adresse; Kontaktverwaltung
- **Projekte:** Projektverwaltung, hierarchische Projektstruktur (Leistungsphasen/Teilleistungen), Leistungsstände, interne Budgets, Projekt-Stundensätze, Verträge, Budgetwarnungen
- **HOAI:** Honorarkalkulation, Honorarzonen/anrechenbare Kosten, Umwandlung Angebot → Projekt inkl. Struktur, Vertrag und Teamzuordnung
- **Angebote:** Angebotserstellung mit Struktur, PDF, Versand, Konvertierung
- **Nachträge:** eigenes Modul mit Prüfbarkeit, Freigabe-Workflow, Fristenüberwachung, PDF und Kennzahlen
- **Rechnungen:** Einzel-, Abschlags-, Teil- und Schlussrechnungen, Gutschriften, Stornierung, Sicherheitseinbehalte, Zahlungszuordnung, Fälligkeitsüberwachung
- **E-Rechnung:** XRechnung in beiden Syntaxen (CII **und** UBL), ZUGFeRD-Hybrid (XML-Einbettung ins PDF), eigener Validator, Anlagen-Einbettung
- **Mahnwesen:** mehrstufig, konfigurierbar, mit E-Mail-Versand
- **Zeiterfassung:** Buchungen, Pausenlogik, sonstige Buchungsarten (Pauschalen/Stückleistungen), Kostensatzrechner, ArbZG-Validierung und -Audit, Monatsabschluss, Zeitkonto/Saldo
- **Personal:** person-zentrierte Mitarbeiterakte, Ein-/Austritt, Gehaltsdaten (rechtegeschützt), Abwesenheits-/Urlaubsverwaltung, Arbeitszeitmodelle
- **Auswertung:** Reporting, Deckungsbeitrags- und Honorarausschöpfungsbetrachtung, Chart-basierte Dashboards, Export
- **Dokumente:** eigener PDF-Renderer (Nunjucks-Templates + Chromium), Dokument- und Textvorlagen, Branding
- **Betrieb/Plattform:** RBAC mit frei definierbaren Rollen, Mandantenfähigkeit, Lizenz-/Capability-Layer, Owner-Konsole zur Kunden- und Lizenzverwaltung, konfigurierbares Benachrichtigungssystem, geführter Datenimport, Onboarding-Checkliste, In-Product-Hilfe

Der Wettbewerbsvergleich der Marktanalyse zeigt: In diesem Segment gibt es entweder flache Tools
(Zeiterfassung ohne HOAI) oder schwere Suiten (PROJEKT PRO, Kobold, wiko) mit 2–6 Monaten Einführungszeit
und intransparenten Preisen. Die Kombination „HOAI-Tiefe + E-Rechnung + Wirtschaftlichkeit + in Tagen produktiv"
ist die belegte Marktlücke.

### A1.3 Architektonischer Vorsprung — SaaS-fähig ab Werk

Drei Eigenschaften, die nachträglich nur mit hohem Aufwand einzubauen sind und hier von Beginn an drin stecken:

1. **Echte Mandantenfähigkeit** — jede Tabelle und jede Abfrage ist mandantengetrennt; ein Kunde mehr kostet keinen weiteren Betrieb.
2. **Rollen- und Rechtesystem (RBAC)** — 98 Rechte-Verknüpfungen, frei konfigurierbare Rollen. Voraussetzung für Büros mit mehreren Nutzern und für Enterprise-Anforderungen.
3. **Lizenz-/Capability-Layer** — 43 Funktionsschalter, in der Owner-Konsole je Tarif pflegbar. Neue Tarife, Testphasen, Limits und Upgrades sind Konfiguration, keine Entwicklung. Das erlaubt Preisexperimente ohne Release.

### A1.4 Betriebswirtschaftlicher Vorsprung — Kostenstruktur

- Fixkosten des laufenden Betriebs derzeit im niedrigen zweistelligen Euro-Bereich pro Monat (Hosting Railway, Datenbank Supabase, Mailversand Eusend, Domain).
- Keine Lizenzkosten für Dritt-Frameworks — der gesamte Stack ist Open Source (MIT/Apache).
- Grenzkosten je zusätzlichem Kundenbüro nahe null; erst ab dreistelliger Kundenzahl entstehen relevante Hosting-Stufen.
- Keine Fremdkapitalkosten, keine Investorenauflagen, keine Gesellschafterabstimmung → volle Entscheidungsgeschwindigkeit.

### A1.5 Zeitliches Fenster (Regulatorik als Rückenwind)

Die E-Rechnungspflicht zwingt die Zielgruppe zu einem festen Termin zum Handeln:
Ausstellungspflicht ab 2027 für Unternehmen > 800.000 € Vorjahresumsatz, ab 2028 für alle.
Rund 60 % der Zielbüros arbeiten heute mit Excel, Word und Outlook und können diese Pflicht
mit ihrem heutigen Setup nicht erfüllen. plan&simple erfüllt sie bereits heute technisch vollständig.
Das ist ein datierter, nicht verhandelbarer Vertriebsanlass — ein Vorteil, den ein späterer Markteintritt nicht mehr hat.

### A1.6 Persönliche Stärken **[ergänzen — Gerüst]**

- Fachlicher Hintergrund und Branchennähe zur Zielgruppe (Architektur-/Ingenieurumfeld, Kenntnis der Abläufe HOAI/Abrechnung) — **[ergänzen: eigene Berufserfahrung, Ausbildung, konkrete Rolle]**
- Eigene Erfahrung mit dem Problem („Problem aus erster Hand", nicht recherchiert) — **[ergänzen]**
- Bestehendes Netzwerk in der Zielgruppe als Zugang zu den ersten Pilotbüros — **[ergänzen: Anzahl erreichbarer Büros]**
- Nachgewiesene Fähigkeit, ein Produkt dieser Komplexität allein zu bauen und zu betreiben (siehe A1.1)

---

## A2 Schwächen (interne Schwächen: fehlende Ressourcen, Abhängigkeiten)

Ehrlich benannt — Fördergeber und Banken bewerten eine offene Schwächenanalyse besser als eine geschönte.
Jeder Punkt ist mit der Gegenmaßnahme aufgeführt.

### A2.1 Personelle Schwächen

| Schwäche | Auswirkung | Gegenmaßnahme |
|---|---|---|
| **Ein-Personen-Unternehmen (Bus-Faktor 1)** | Krankheit/Ausfall legt Entwicklung, Support und Vertrieb gleichzeitig still | Dokumentierte Architektur (CLAUDE.md, 8 Konzeptdokumente), versionierte Migrationen, automatisierte Tests und Auto-Deploy machen die Codebasis übergabefähig; ab Kundenstamm > ~30 Büros externer Entwickler auf Stundenbasis als Backup |
| **Kein Vertriebs-Track-Record** | Kernkompetenz liegt in Produkt/Technik, nicht im Verkauf | Founder-led Sales in Phase 1 bewusst als Lernphase geplant; Self-Service-Funnel als Skalierungsweg, damit Vertrieb nicht zum Engpass wird |
| **Kein Marketing-/Content-Hintergrund** | SEO und Positionierung sind erfolgskritisch, aber ungeübt | Tier-1-Fokussierung auf drei Kanäle statt acht; Content aus der eigenen Fachkompetenz (HOAI, E-Rechnung) statt aus Marketing-Handwerk |
| **Zeitliche Doppelbelastung** | Produktweiterentwicklung, Vertrieb und Support konkurrieren um dieselbe Person | Gründungszuschuss sichert die Vollzeit-Widmung in der kritischen Aufbauphase; strikte Kanal- und Feature-Priorisierung |
| **Kein Support-Team** | Reaktionszeiten bei wachsender Kundenzahl | In-Product-Hilfe und Onboarding-Automatisierung senken das Ticketaufkommen strukturell; Support-SLA erst ab Enterprise-Tarif zugesagt |

### A2.2 Markt- und Geschäftsschwächen

| Schwäche | Auswirkung | Gegenmaßnahme |
|---|---|---|
| **Keine Referenzkunden / kein Markenname** | Zielgruppe ist software-skeptisch und wechselscheu; „Wer nutzt das sonst?" ist die erste Frage | Design-Partner-Programm (10–20 Büros, vergünstigt gegen Referenz und Bewertung); Ziel: 3–5 zitierfähige Referenzen vor dem öffentlichen Launch |
| **Kein Werbebudget** | Kein Ausgleich für Fehlversuche in bezahlten Kanälen | Organische Kanäle zuerst (SEO, Vergleichsportale, Empfehlung); bezahlte Anzeigen erst nach validierter Conversion |
| **Kein Umsatz zum Zeitpunkt der Gründung** | Finanzierungslücke in der Anlaufphase | Gründungszuschuss; niedrige Fixkosten; kein Personal- und Büroaufwand |
| **Unvalidiertes Pricing** | 25 €/39 € je Nutzer sind kalibriert, aber nicht am Markt getestet | Preisvalidierung als expliziter Bestandteil der Pilotgespräche; Lizenzarchitektur erlaubt Preis-/Paketänderung ohne Release |
| **Lange Verkaufszyklen im Bestand** | Wechsel von einem Bestandssystem dauert; Excel-Nutzer entscheiden schneller | Bewusste Fokussierung auf Excel-Umsteiger statt auf Wettbewerbsverdrängung |
| **Baukonjunktur** | Investitionszurückhaltung der Zielgruppe | Antizyklische Argumentation: In der Flaute ist Wirtschaftlichkeitssteuerung das stärkere Kaufargument |

### A2.3 Technische Schwächen und Abhängigkeiten

| Abhängigkeit / Schwäche | Risiko | Gegenmaßnahme |
|---|---|---|
| **Hosting Railway** | Anbieterausfall, Preisänderung, Ressourcengrenzen (u. a. SMTP-Sperre bereits erlebt) | Anwendung ist containerisiert und portabel (Docker, keine proprietären Bindungen); Wechsel zu Hetzner/Fly/Render mit überschaubarem Aufwand möglich |
| **Datenbank Supabase (PostgreSQL)** | Anbieterbindung, Preisstufen | Standard-PostgreSQL ohne proprietäre Erweiterungen; Migration auf eigenen Postgres jederzeit möglich; alle Schemaänderungen liegen als 119 SQL-Migrationen versioniert vor |
| **Mailversand Eusend** | Zustellbarkeit, Anbieterausfall | Globaler SMTP-Fallback bereits implementiert |
| **Zugriff über Service-Role-Key statt Datenbank-RLS** | Mandantentrennung wird auf Anwendungsebene erzwungen; ein Programmierfehler könnte theoretisch Daten anderer Mandanten sichtbar machen | Einheitliches Service-Pattern, Code-Reviews, Testabdeckung; **geplant: Row-Level-Security als zweite Verteidigungslinie (Meilenstein M4)** |
| **Migrationen werden manuell eingespielt** | Bedienfehler beim Deployment | Migrationsrunner (`npm run migrate`) vorhanden; Umstellung auf automatisierten Lauf im Deploy geplant |
| **Punktuelle statt flächendeckende Testabdeckung** | Regressionsrisiko bei wachsendem Funktionsumfang | Testabdeckung wächst mit jedem sicherheits-/geldrelevanten Modul (E-Rechnungs-Validator, Lizenzlogik, Import, Auth sind abgedeckt); Ausbau als laufende Aufgabe |
| **PDF-Erzeugung via Chromium** | speicherintensiv, Skalierungsgrenze bei vielen parallelen Renderings | Renderer ist gekapselt und horizontal auslagerbar (eigener Worker-Dienst) |
| **KI-gestützte Entwicklung als Produktivitätshebel** | Abhängigkeit von einem externen Werkzeug/Anbieter | Der erzeugte Code ist Standard-JavaScript/TypeScript ohne Bindung an das Werkzeug und vollständig im eigenen Repository; der Hebel betrifft die Geschwindigkeit, nicht die Betriebsfähigkeit |

### A2.4 Rechtliche und organisatorische Lücken **[teilweise ergänzen]**

- **Datenschutz:** AV-Vertrag (Art. 28 DSGVO), Verzeichnis von Verarbeitungstätigkeiten, TOM-Dokumentation und Datenschutzerklärung müssen vor dem ersten zahlenden Kunden vorliegen — **derzeit offen**
- **Vertragswerk:** AGB/SaaS-Nutzungsbedingungen, Preis- und Kündigungsregelungen, Verfügbarkeitszusagen — **derzeit offen**
- **Serverstandort:** EU-Hosting ist für die Zielgruppe kaufentscheidend und muss belegbar sein (Railway-Region/Supabase-Region prüfen und dokumentieren)
- **Zertifizierungen:** keine (ISO 27001, TISAX o. Ä.) — für das Zielsegment 2–10 Personen zunächst nicht erforderlich, ab Enterprise-Kunden relevant
- **Externe Sicherheitsprüfung:** bisher nicht durchgeführt — als Meilenstein eingeplant
- **Versicherung:** Berufshaftpflicht/Vermögensschadenhaftpflicht für IT-Dienstleister — **[ergänzen: Status]**
- **Rechtsform, Steuern, Buchhaltung** — **[ergänzen]**

---

## A3 Lücken in Team & Plan — und wie sie geschlossen werden

Die Fragestellung „Welche Kompetenzen fehlen und wie schließt ihr sie?" beantwortet man am
überzeugendsten mit einer Tabelle aus Lücke, Kritikalität, Lösungsweg und Zeitpunkt.

| # | Fehlende Kompetenz / Ressource | Kritikalität | Wie geschlossen | Wann |
|---|---|---|---|---|
| 1 | **Vertrieb & Neukundengewinnung** | hoch | Zunächst bewusst selbst („Founder-led Sales") — in dieser Phase ist der Gründer der beste Verkäufer, weil er die Fachsprache spricht. Skalierung danach über Self-Service statt über Vertriebspersonal. Fallback: Vertriebspartner auf Provisionsbasis | Ab 08/2026 laufend; Entscheidung über externe Unterstützung ab 50 Kunden |
| 2 | **Content-Marketing & SEO** | hoch | Fachinhalte (HOAI, E-Rechnung) schreibt der Gründer selbst — Fachtiefe ist hier der eigentliche Wettbewerbsvorteil; Lektorat/SEO-Feinschliff als Freelancer-Zukauf (geringer vierstelliger Betrag/Jahr) | Ab 08/2026 |
| 3 | **UX-/Visual-Design** | mittel | Bestehendes Design-System (einheitliche Listen-, Modal- und Icon-Standards) trägt den Funktionsumfang; punktueller Zukauf für Landingpage, Produkttour und Marken-Auftritt | Q3–Q4 2026 |
| 4 | **Recht (SaaS-Verträge, DSGVO, AGB)** | hoch — Launch-Blocker | Externe Fachkanzlei bzw. geprüfte Vertragsvorlagen; einmaliger Aufwand im niedrigen vierstelligen Bereich | vor erstem zahlenden Kunden (Q3 2026) |
| 5 | **Steuer & Buchhaltung** | mittel | Steuerberater — zugleich potenzieller Multiplikator in die Zielgruppe (Steuerberater beraten Büros gerade jetzt zur E-Rechnung) | ab Gründung |
| 6 | **IT-Sicherheit (unabhängige Prüfung)** | mittel–hoch | Externer Penetrationstest / Security-Audit, sobald zahlende Kunden Echtdaten führen; Grundhärtung (Helmet, Rate-Limiting, CORS-Allowlist, erzwungenes JWT-Secret, bcrypt) ist bereits umgesetzt | Q1 2027 |
| 7 | **Zweiter Entwickler (Ausfallsicherheit)** | mittel, steigend | Ab tragfähigem Umsatz Werkstudent oder freier Entwickler; die dokumentierte Architektur ist auf Einarbeitung ausgelegt | ab ~30 zahlenden Büros / ~50 T€ ARR |
| 8 | **Kundensupport im Regelbetrieb** | mittel, steigend | Struktureller Ansatz zuerst: In-Product-Hilfe, geführtes Onboarding, Self-Service-Wissensbasis; personelle Verstärkung erst, wenn Ticketvolumen es erzwingt | ab 2027 |
| 9 | **Fachliche Absicherung HOAI / Bauvertragsrecht** | mittel | Fachlicher Beirat aus 2–3 Pilotbüros bzw. Kammer-Kontakten; Prüfung der Honorar- und Nachtragslogik im Praxiseinsatz | ab 08/2026 mit dem Design-Partner-Programm |
| 10 | **Betriebswirtschaftliches Sparring / Mentoring** | niedrig–mittel | Gründerzentrum, IHK-Beratung, geförderte Gründungsberatung (BAFA), Peer-Netzwerk anderer Bootstrapper | ab Gründung |

**Zusätzliche Lücken im *Plan* (nicht im Team) — bewusst als offene Hypothesen geführt:**

1. **Preisniveau unvalidiert** → Test in den ersten 10–15 Pilotgesprächen; Lizenzsystem erlaubt Anpassung ohne Release.
2. **Conversion Trial → zahlend unbekannt** → Zielkorridor 20–30 % der *aktivierten* Trials; erste Messung ab Soft Launch Q4 2026.
3. **Aktivierungshürde Datenimport** → als größtes operatives Risiko identifiziert; deshalb höchste Produktpriorität auf dem geführten Import.
4. **Kanalwirksamkeit unbewiesen** → drei Tier-1-Kanäle parallel testen, nach 3 Monaten der wirksamste verdoppeln, die schwächsten einstellen.
5. **Kein Notfallplan bei ausbleibender Traktion** → definierte Abbruch-/Anpassungsschwelle: Werden bis Ende Q1 2027 weniger als 10 zahlende Büros erreicht, werden Zielsegment oder Wedge überprüft (z. B. Fokusverschiebung auf reine Zeiterfassung + E-Rechnung als günstigeres Einstiegsprodukt).

---

## A4 Motivation — Leitfaden zum Selbstausfüllen

Der Abschnitt ist bewusst persönlich und sollte in eigener Sprache geschrieben werden.
Bewährte Struktur, jeweils mit den Fragen, die Fördergeber tatsächlich lesen wollen:

**1. Der Auslöser (Woher kenne ich das Problem?)**
- In welcher Situation ist mir zum ersten Mal aufgefallen, dass Planungsbüros ihre Wirtschaftlichkeit nicht kennen? **[ergänzen]**
- Welche konkrete Erfahrung steht dahinter (eigener Arbeitsalltag, Beobachtung im Büro, Gespräch mit Kollegen)? **[ergänzen]**

**2. Warum ich (Qualifikation und Legitimation)**
- Welche fachliche und welche technische Vorerfahrung bringe ich mit? **[ergänzen]**
- Warum bin ich in der seltenen Lage, beide Seiten zu verstehen — die Fachdomäne HOAI/Planungsbüro *und* die Softwareentwicklung? Genau diese Kombination ist der Grund, warum ein Einzelner hier ein Produkt bauen kann, an das sich größere Anbieter nicht heranwagen.

**3. Warum jetzt**
- Die E-Rechnungspflicht zwingt einen ganzen Markt in einem definierten Zeitfenster zum Handeln.
- Gleichzeitig macht KI-gestützte Entwicklung es erstmals möglich, als Einzelperson ein Produkt in dieser Tiefe zu bauen — ein Zeitfenster, das es vor zwei Jahren nicht gab.

**4. Was mich antreibt (jenseits des Geldes)**
- Unabhängigkeit und selbstbestimmtes Arbeiten **[ergänzen/ausformulieren]**
- Handwerklicher Anspruch: Software bauen, die Menschen im Alltag wirklich entlastet, statt Funktionslisten zu bedienen
- Der Wunsch, ein Produkt vom ersten Gedanken bis zum zahlenden Kunden vollständig zu verantworten

**5. Wo ich in fünf Jahren stehen will**
- Persönliches Zielbild — passend zur Unternehmensvision in B5 **[ergänzen]**

---

# TEIL B — Produkt / Technisch / Details

## B1 Technologie & Tech-Stack

### B1.1 Architektur in einem Satz

plan&simple ist eine mandantenfähige Web-Anwendung (SaaS): ein React-Frontend im Browser des Nutzers,
eine Node.js-REST-API im Backend und eine PostgreSQL-Datenbank — vollständig containerisiert
und in einer europäischen Cloud betrieben. Es gibt keine lokale Installation beim Kunden,
kein Update-Verfahren beim Kunden und keine kundenspezifischen Server.

### B1.2 Technologie im Überblick

| Schicht | Technologie | Warum diese Wahl |
|---|---|---|
| **Frontend** | React 19, TypeScript 5.9, Vite 8, TanStack Query 5, Zustand 5, Chart.js, Lucide Icons | Marktstandard mit größtem Entwicklerpool; TypeScript verhindert eine ganze Fehlerklasse bereits beim Bauen; Vite liefert sehr kurze Entwicklungszyklen |
| **Backend** | Node.js 20, Express 5 | Eine Sprache über den gesamten Stack — für ein kleines Team entscheidend; sehr großes Ökosystem |
| **Datenbank** | PostgreSQL (betrieben über Supabase) | Bewährtestes relationales Open-Source-System; Transaktionssicherheit für Buchhaltungs- und Rechnungsdaten zwingend; kein Anbieter-Lock-in |
| **Authentifizierung** | Eigene JWT-Implementierung (`jsonwebtoken`), Passwörter mit bcrypt gehasht, 8-Stunden-Sitzungen | Volle Kontrolle über Mandantenkontext und Rechteprüfung; keine Fremdkosten pro Nutzer |
| **Autorisierung** | Eigenes RBAC — frei definierbare Rollen, 98 Rechte-Verknüpfungen | Büros brauchen Sichtbarkeitsgrenzen (z. B. Gehaltsdaten, Projektkosten) |
| **Lizenzierung** | Eigener Capability-Layer: 12 Module, 43 Schalter, Tarifzuordnung in der Datenbank | Tarife, Limits und Testphasen sind Konfiguration statt Code |
| **Dokumente/PDF** | Playwright-Chromium + Nunjucks-Templates | Layouttreue wie im Browser, volle Gestaltungsfreiheit, keine Lizenzkosten kommerzieller PDF-Bibliotheken |
| **E-Rechnung** | Eigene Erzeugung von XRechnung (CII und UBL), ZUGFeRD-Einbettung via `pdf-lib`, eigener Validator | Gesetzliche Pflichtfunktion; Eigenentwicklung vermeidet laufende Gebühren externer Konverter-Dienste |
| **E-Mail** | Eusend (SMTP, EU-Hosting) | Per-Mandant- oder globaler SMTP-Versand über nodemailer |
| **Dateiimport** | `xlsx` — geführter Excel-/CSV-Import mit Feld-Mapping und Rollback | Der zentrale Conversion-Hebel beim Onboarding |
| **Hosting/Betrieb** | Railway (Docker), Auto-Deploy aus dem `main`-Branch | Kein eigener Serverbetrieb; Deploy in Minuten; monatliche Kosten im niedrigen zweistelligen Bereich |
| **Qualitätssicherung** | Jest (Backend), Vitest (Frontend-Unit), Playwright (End-to-End inkl. Mobil-Viewports), ESLint, TypeScript-Buildprüfung | Automatisierte Prüfung sicherheits- und geldrelevanter Logik vor jedem Deploy |
| **Mobil** | Responsive Web-App; Android-Wrapper im Aufbau | Zeiterfassung muss auf der Baustelle funktionieren |

### B1.3 Warum die Lösung technisch tragfähig und skalierbar ist

Für den Businessplan sind fünf Argumente relevant:

1. **Mandantenfähigkeit statt Einzelinstallationen.** Alle Kunden laufen auf derselben Anwendung
   und derselben Datenbank, sauber getrennt über eine Mandanten-Kennung an jedem Datensatz.
   Ein neuer Kunde bedeutet einen Datensatz, keinen neuen Server, keine Installation, keinen Technikeraufwand.
   Genau das erlaubt die Grenzkosten nahe null.

2. **Horizontale Skalierbarkeit.** Das Backend ist zustandslos — die Sitzungsinformation steckt im JWT,
   nicht im Server. Bei steigender Last werden schlicht weitere Instanzen gestartet; ein Umbau ist dafür nicht nötig.
   Der ressourcenintensivste Teil (PDF-Erzeugung) ist gekapselt und lässt sich als eigener Dienst auslagern.

3. **Belastbare Datenschicht.** PostgreSQL bewältigt das erwartete Datenvolumen um Größenordnungen:
   Ein Büro mit 10 Personen erzeugt etwa 25.000 Zeitbuchungen pro Jahr — 500 solcher Büros
   ergäben ~12,5 Mio. Datensätze pro Jahr, was für PostgreSQL auf Standard-Hardware unkritisch ist.
   Die Skalierungsgrenze liegt damit weit jenseits der Umsatzplanung.

4. **Änderbarkeit als Wettbewerbsvorteil.** 119 versionierte Migrationen, strikte Schichtentrennung,
   typisiertes Frontend und automatisierte Tests bedeuten: Neue Funktionen und Kundenwünsche
   werden in Tagen umgesetzt, nicht in Quartalen. Bei den etablierten Anbietern liegen zwischen
   Kundenwunsch und Release oft Jahresversionen. Für ein kleines Unternehmen ist Reaktionsgeschwindigkeit
   das stärkste verbliebene Differenzierungsmerkmal.

5. **Keine Abhängigkeit von proprietären Bausteinen.** Der gesamte Stack ist Open Source.
   Es gibt keine Nutzungsgebühren Dritter pro Kunde, keine Lizenzstaffeln, keine Vertragsrisiken —
   und im Zweifel die Möglichkeit, den Anbieter zu wechseln, weil alles auf offenen Standards
   (Docker, PostgreSQL, HTTP/REST) aufsetzt.

### B1.4 Sicherheit und Datenschutz — Stand

**Umgesetzt:** Passwort-Hashing mit bcrypt · erzwungenes JWT-Geheimnis (die Anwendung startet ohne
sicheres Geheimnis nicht) · Helmet-Sicherheitsheader · Rate-Limiting auf den Authentifizierungsrouten ·
CORS-Allowlist · Mandantenprüfung in jedem Service · rechtebasierte Absicherung jedes ändernden Endpunkts ·
verschlüsselte Ablage von Zugangsdaten (Mailkonten) · HTTPS durchgängig · automatisierte Tests
für Authentifizierung, Lizenzgrenzen und E-Rechnungs-Validierung.

**Offen (eingeplant):** Row-Level-Security auf Datenbankebene als zweite Verteidigungslinie ·
unabhängiger Penetrationstest · dokumentiertes Backup-/Wiederherstellungsverfahren mit Übungslauf ·
AV-Vertrag, TOM-Dokumentation und Verarbeitungsverzeichnis · Nachweis des EU-Serverstandorts.

---

## B2 Meilensteine (nächste 12–24 Monate)

Zeitachse ab 08/2026. Jeder Meilenstein mit überprüfbarem Ergebnis — so, wie Fördergeber es erwarten.

### Phase 1 — Marktvorbereitung (Q3 2026)

| # | Meilenstein | Ergebnis / Nachweis | Zeitpunkt |
|---|---|---|---|
| M1 | **Rechtliche Marktreife** | AGB, AV-Vertrag, Datenschutzerklärung, TOM-Dokumentation liegen vor; Impressum und Widerrufsregelung online | 09/2026 |
| M2 | **Geführter Datenimport produktiv** | Ein Büro kann Adressen, Projekte, Stunden und Anfangsbestände aus Excel selbstständig übernehmen — inkl. Mapping-Assistent, Vorschau und Rollback | 09/2026 |
| M3 | **Zahlungsabwicklung & Selbstregistrierung** | Interessent kann sich ohne Zutun des Gründers registrieren, 30 Tage testen und per Zahlungsanbieter (Stripe o. ä.) in einen Tarif wechseln | 10/2026 |
| M4 | **Sicherheitshärtung Stufe 2** | Row-Level-Security aktiv, Backup-Wiederherstellung erfolgreich geprobt, Migrationslauf automatisiert | 10/2026 |
| M5 | **Design-Partner-Programm** | 10–20 Büros angesprochen, **5 aktiv onboardet**, erste Referenzzitate mit Zahlen | 09/2026 |

### Phase 2 — Markteintritt (Q4 2026)

| # | Meilenstein | Ergebnis / Nachweis | Zeitpunkt |
|---|---|---|---|
| M6 | **Soft Launch** | Öffentliche Verfügbarkeit; Landingpage mit öffentlicher Preistabelle, Produkttour und 3 Referenzen live | 10/2026 |
| M7 | **Erste zahlende Kunden** | **5–15 zahlende Büros**, davon mindestens 3 aus Pilotkonvertierung | 11/2026 |
| M8 | **Sichtbarkeit** | Profile auf allen relevanten Vergleichsportalen (plansync, phase0, softwareabc24, OMR/Capterra) mit ≥ 5 echten Bewertungen; 6+ Fachartikel veröffentlicht | 12/2026 |
| M9 | **Multiplikator-Nachweis** | Erstes Kammer-/Verbands-Webinar durchgeführt (Thema HOAI + E-Rechnung im kleinen Büro) | 12/2026 |
| M10 | **Geschäftsjahresabschluss 2026** | **15–30 zahlende Büros, ~25–50 T€ ARR-Lauf**; Trial→Paid-Quote gemessen | 12/2026 |

### Phase 3 — Product-Market-Fit nachweisen (H1 2027)

| # | Meilenstein | Ergebnis / Nachweis | Zeitpunkt |
|---|---|---|---|
| M11 | **Self-Service funktioniert ohne Zutun** | Mindestens 5 Kunden sind ohne persönlichen Kontakt vom Trial zur Zahlung gekommen — der entscheidende Skalierungsbeleg | Q1 2027 |
| M12 | **Break-even des laufenden Betriebs** | Monatliche Einnahmen decken Hosting, Werkzeuge, Steuerberatung und Versicherungen vollständig | Q1 2027 |
| M13 | **DATEV-/Buchhaltungsschnittstelle** | Rechnungs- und Zahlungsexport im DATEV-Format; erste Steuerberater als Empfehlungsgeber gewonnen | Q1 2027 |
| M14 | **Unabhängige Sicherheitsprüfung** | Externer Pentest durchgeführt, Befunde behoben, Bericht als Vertriebsargument verfügbar | Q1 2027 |
| M15 | **Retention nachgewiesen** | Monatliche Abwanderung < 2 %; ≥ 3 Kunden haben Sitze aufgestockt oder auf Pro gewechselt | Q2 2027 |
| M16 | **50 zahlende Büros** | ARR-Lauf ~60–90 T€ | Q2 2027 |

### Phase 4 — Tragfähigkeit und Wachstum (H2 2027 – 2028)

| # | Meilenstein | Ergebnis / Nachweis | Zeitpunkt |
|---|---|---|---|
| M17 | **Persönlicher Break-even** | Unternehmerlohn vollständig aus laufenden Einnahmen — Unabhängigkeit von der Förderung | Q3 2027 |
| M18 | **100 zahlende Büros** | ARR-Lauf ~150 T€; nachgewiesen wiederholbare Kundengewinnung | Q4 2027 |
| M19 | **Erste Verstärkung** | Freier Entwickler oder Werkstudent eingearbeitet; Bus-Faktor > 1 | Q4 2027 |
| M20 | **Mobile App veröffentlicht** | Zeiterfassung als Android-/iOS-App in den Stores | H1 2028 |
| M21 | **Peppol-Anbindung** | Grenzüberschreitender E-Rechnungs-Versand über das Peppol-Netzwerk aktiv | H1 2028 |
| M22 | **Öffnung DACH** | Erste zahlende Kunden in Österreich (HOAI-Pendant/Honorarordnung berücksichtigt) | 2028 |
| M23 | **200+ zahlende Büros** | ARR-Lauf ~300 T€; tragfähiges Kleinunternehmen mit 1–3 Personen | Ende 2028 |

---

## B3 Produkt-Roadmap — was nach dem MVP kommt

Der MVP-Umfang ist bereits überschritten: Alle Kernmodule sind implementiert (siehe A1.2).
Die Roadmap ist deshalb keine Aufbau-, sondern eine **Marktreife- und Vertiefungs-Roadmap**.
Priorisierung nach Verkaufswirkung, nicht nach technischer Eleganz.

### R0 — Launch-Blocker (bis Q4 2026, alles andere nachrangig)

| Vorhaben | Nutzen | Status |
|---|---|---|
| **Geführter Datenimport (Adressen, Projekte, Stunden, Anfangsbestände)** | Beseitigt die größte Wechselhürde und ist zugleich das stärkste Differenzierungsmerkmal | Architektur und Konzept fertig, vertikaler Durchstich Adressen umgesetzt, Ausbau läuft |
| **Selbstregistrierung + Bezahlvorgang** | Ohne Self-Service kein skalierbares Geschäft | offen |
| **Öffentliche Landingpage mit Preistabelle und Produkttour** | Einstiegspunkt aller Kanäle | Entwurf und Copy liegen vor |
| **Onboarding-Strecke im Produkt** (Checkliste, Ersteinrichtung, In-Product-Hilfe) | Aktivierung ohne Schulung — Voraussetzung für Trial→Paid | umgesetzt, wird verfeinert |
| **Rechtliches Paket (AGB, AVV, Datenschutz)** | Verkaufsvoraussetzung | offen |

### R1 — Aktivierung und Bindung (Q4 2026 – Q1 2027)

- **Individualisierbare PDF-Vorlagen** — Stilvorlagen und Konfigurator mit Live-Vorschau, damit jedes Büro
  seine Angebote und Rechnungen im eigenen Erscheinungsbild versendet (Konzept liegt vor).
  Hoher wahrgenommener Wert, geringer Streit um Funktionsumfang.
- **Erweitertes Controlling** — Deckungsbeitrag je Leistungsphase und Mitarbeiter, Honorarausschöpfung,
  Frühwarnung bei drohender Unterdeckung. Das ist die inhaltliche Einlösung des Kernversprechens.
- **DATEV-/Buchhaltungsexport** — beseitigt den letzten Medienbruch und erschließt Steuerberater als Multiplikatoren.
- **Kundenspezifische Auswertungen und Exportformate** — direkt aus dem Pilotfeedback gespeist.

### R2 — Differenzierung und Upsell (2027)

- **Liquiditäts- und Kapazitätsplanung** — „Wie sind wir die nächsten drei Monate ausgelastet, und wann kommt welches Geld herein?"
  Das ist die inhaltliche Abgrenzung des Pro-Tarifs und der stärkste Upsell-Hebel.
- **Mobile App für Zeiterfassung** (Android zuerst, iOS danach) — Erfassung dort, wo die Arbeit stattfindet.
- **Service-/Feedback-Bereich mit Vorschlags-Voting** — Kunden priorisieren die Roadmap sichtbar mit;
  Bindungs- und Marketinginstrument zugleich (Konzept liegt vor, datenschutzseitig durchdacht).
- **Peppol-Anbindung** und **ZUGFeRD-Vollausbau** — vervollständigt die E-Rechnungsfähigkeit für alle Empfängerarten.
- **Offene API und Webhooks** für Enterprise-Kunden — Anbindung von CAD-, DMS- oder Buchhaltungssystemen.
- **Dokumentenmanagement light** — Projektablage für Schriftverkehr und Anlagen.

### R3 — Marktausweitung (2028)

- **Mehrsprachigkeit und Länderlogik** (Österreich, Schweiz) — abweichende Honorarordnungen, Steuersätze, E-Rechnungsnormen.
- **Branchen-Templates** über die Architektur hinaus: TGA-, Tragwerks-, Vermessungs- und Infrastrukturplanung
  mit vorkonfigurierten Leistungsbildern.
- **Partner-/Wiederverkäufer-Modell** für Kammern, Verbände und Steuerberater.
- **KI-Assistenz im Produkt** — z. B. Vorschläge für Leistungsbeschreibungen, automatische Zuordnung von
  Zeitbuchungen zu Projektelementen, Plausibilitätsprüfung von Nachtragsbegründungen.
  Bewusst nachrangig: erst wenn die Grundlagen sitzen, sonst Spielerei statt Nutzen.

### Nicht geplant (bewusstes Weglassen — als Schärfungsargument im Plan wertvoll)

- Kein CAD-/BIM-Funktionsumfang — anderer Markt, andere Kompetenz.
- Keine Finanzbuchhaltung — Schnittstelle zum Steuerberater statt Konkurrenz zu DATEV/lexoffice.
- Keine Baustellendokumentation/Mängelmanagement — eigener Markt mit eigenen Anbietern.
- Kein Fokus auf Büros ≥ 20 Personen vor 2028 — widerspricht dem Versprechen radikaler Einfachheit.

---

## B4 Langfristige Vision (3–5 Jahre)

### B4.1 Zielbild 2029/2030

> plan&simple ist in Deutschland die Standardsoftware für kleine Planungsbüros, die zum ersten Mal
> ein professionelles Bürowerkzeug einführen — bekannt dafür, dass ein Büro damit an einem Tag
> produktiv wird statt in einem Quartal, und dass jeder Inhaber jederzeit weiß, ob seine Projekte Geld verdienen.

### B4.2 Entwicklungsstufen

**Stufe 1 — Fuß fassen (2026/2027): „Das einfachste Werkzeug für den Einstieg."**
Ziel: 100 zahlende Büros, tragfähiger Unternehmerlohn, nachgewiesen wiederholbare Kundengewinnung.
Fokus Deutschland, Segment 2–10 Personen, Kernbotschaft Wirtschaftlichkeit + E-Rechnung.

**Stufe 2 — Verankern (2028): „Das Büro läuft darin."**
Ziel: 200–350 Büros, 300–500 T€ ARR, 2–3 Personen im Unternehmen.
Ausbau zur vollständigen Büroplattform (Liquidität, Kapazität, Dokumente, Mobil).
Expansion nach Österreich und in die Schweiz. Erste Partnerkanäle über Kammern und Steuerberater.

**Stufe 3 — Segment erweitern (2029/2030): „Nicht nur Architekten."**
Ziel: 500–800 Büros, 0,8–1,5 Mio. € ARR, 5–8 Personen.
Öffnung zu benachbarten projektbasierten Dienstleistern mit identischer Struktur
(Zeit → Projekt → Honorar → Rechnung): Fachplanung aller Disziplinen, Sachverständige,
Gutachter, Vermessung, Projektsteuerung, ggf. weitere Freiberuflergruppen mit Honorarordnung.
Die Software ist dafür bereits vorbereitet — Leistungsbilder, Honorarlogik und Rollen sind konfigurierbar,
nicht einprogrammiert.

**Stufe 4 — Plattform (ab 2030): „Ökosystem statt Einzelprodukt."**
Offene Schnittstellen, Partnerlösungen (CAD, DMS, Buchhaltung, Bank), Marktplatz für
Vorlagen und Leistungsbilder; KI-gestützte Assistenz als selbstverständlicher Teil der Bedienung.

### B4.3 Marktpotenzial (Obergrenze, aus der Marktanalyse)

- **TAM/SAM:** ~61.000 Büros mit 2–9 Personen in Deutschland, erweitert ~68.500 Büros mit 2–19 Personen.
- **SOM-Szenario:** bei 5 % Durchdringung des adressierbaren Marktes und einem mittleren Preisniveau
  von 25 €/Nutzer/Monat ergibt sich ein Potenzial von rund **8 Mio. € ARR in Jahr 5**.
- **Eigene Planung liegt bewusst weit darunter** (siehe B2): Der SOM beschreibt die Obergrenze des Marktes,
  nicht die Zielmarke eines bootstrapped Ein-Personen-Unternehmens. Die eigenen Zielmarken sind
  bewusst konservativ und aus eigener Kraft ohne Fremdkapital erreichbar.

### B4.4 Wie das Unternehmen aussehen soll

- **Bootstrapped, profitabel, unabhängig.** Kein Wagniskapital, kein Wachstumszwang von außen.
  Wachstum finanziert sich aus dem laufenden Geschäft.
- **Klein und hochproduktiv.** Ziel sind 5–8 Personen bei 1–1,5 Mio. € Umsatz — möglich,
  weil Entwicklung, Betrieb und Support von Anfang an auf Automatisierung ausgelegt sind.
- **Produktqualität vor Funktionsmenge.** Das Versprechen „radikal einfach" ist nur zu halten,
  wenn konsequent auch abgelehnt wird — die Liste des bewusst Weggelassenen (B3) ist Teil der Strategie.
- **Exit-Optionen offen, aber kein Selbstzweck.** Ein profitables, wachsendes Nischenprodukt mit
  wiederkehrenden Erlösen ist für strategische Käufer (Branchensoftware-Konsolidierer, wie die
  PE-Beteiligung bei einem Wettbewerber zeigt) attraktiv — ein Verkauf ist eine Option, kein Ziel.

---

# Anhang — Zahlen für den Finanzplan

Bausteine, die sich aus den obigen Angaben direkt in den Finanzplan übernehmen lassen:

**Preismodell (Hypothese v1)**

| Tarif | Preis je Nutzer/Monat (jährlich) | Preis je Nutzer/Monat (monatlich) | Zielgruppe |
|---|---|---|---|
| Test | 0 € (30 Tage Vollzugang) | — | Evaluierung |
| Basic | 25 € | 29 € | 2–5 Personen |
| Pro | 39 € | 45 € | 6–10(–25) Personen |
| Enterprise | individuell | — | 25+ Personen |

**Abgeleitete Durchschnittserlöse je Kunde (ACV)**
- 4-Personen-Büro im Basic: ~100 €/Monat → **~1.200 €/Jahr**
- 8-Personen-Büro im Pro: ~310 €/Monat → **~3.700 €/Jahr**
- Kalkulatorischer Mischwert für die Planung: **~1.500 €/Jahr je Kunde**

**Umsatzplanung (konservativ, aus B2 abgeleitet)**

| Zeitpunkt | Zahlende Büros | ARR-Lauf |
|---|---|---|
| Ende 2026 | 15–30 | ~25–50 T€ |
| Ende 2027 | 50–100 | ~80–150 T€ |
| Ende 2028 | 200–350 | ~300–500 T€ |

**Kostenstruktur (laufend, Anlaufphase)**
- Hosting, Datenbank, Mailversand, Domain: niedriger zweistelliger bis niedriger dreistelliger Euro-Betrag/Monat, mit Kundenzahl skalierend
- Entwicklungswerkzeuge/KI-Assistenz: **[ergänzen: tatsächliche monatliche Kosten]**
- Steuerberatung, Versicherungen, Kammer-/Verbandsbeiträge: **[ergänzen]**
- Einmalig vor Launch: Rechtsberatung (AGB/AVV/Datenschutz), Design-Zukauf für Landingpage, Sicherheitsprüfung
- Marketing: bewusst nahe null in Phase 1 (organische Kanäle), erste bezahlte Tests ab Q4 2026 in kleinem Umfang

**Kennzahlen, die gemessen werden**
- North Star: Anzahl aktiver **zahlender Büros**
- Besucher → Trial-Start: Ziel 3–5 %
- Trial → zahlend (bezogen auf *aktivierte* Trials): Ziel 20–30 %
- Aktivierungsquote (Trial mit abgeschlossenem Datenimport und erster Auswertung)
- Monatliche Abwanderung: Ziel < 2 %
- Netto-Umsatzbindung (Aufstockung von Sitzen/Tarifen)
