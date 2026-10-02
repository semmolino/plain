# CLAUDE.md — plan&simple project context

**Produktname: „plan&simple"** (kleingeschrieben, mit Ampersand) — so heißt es in der Oberfläche, im Logo und gegenüber Nutzern. Der alte Name „PlaIn" stammt aus der Frühphase; **in jedem user-facing Text „plan&simple" verwenden**. Code-Bezeichner/Ordner (`plain/`, `tenantId`, …) bleiben unverändert.

plan&simple is a **multi-tenant business management tool** for architects and planners: offers, projects, invoices (Abschlags- & Schlussrechnungen), contracts, employees, and address management. It is a German-language product deployed as a public SaaS on **Scalingo**.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22 + Express, `@supabase/supabase-js` (service-role client) |
| Database | **Scalingo PostgreSQL** über lokales PostgREST (`127.0.0.1:3001`), angesprochen mit dem supabase-js-Client — kein rohes SQL im App-Code. RLS ist aktiv und erzwungen (`is_system_request()` / `current_tenant_id()`). Das alte Supabase-Projekt hängt nur noch als Altbestand in den Variablen und enthält einen **veralteten Datenstand** — nicht dorthin schreiben. |
| Auth | Custom JWT (`jsonwebtoken` + `bcryptjs`), 8h expiry, secret from `JWT_SECRET` env var |
| Frontend | React 18, TypeScript, Vite, Tanstack Query v5, Zustand, React Router v6 |
| PDF generation | Playwright-chromium + Nunjucks templates (`backend/templates/modern_a/`) |
| Deployment | **Scalingo** (`planandsimple`) — Pushes auf `main` deployen automatisch; Frontend wird im Container gebaut. `Procfile` → `bin/start-web.sh` startet PostgREST **und** Node im selben Container. |
| E-invoicing | XRechnung (CII + UBL) generated server-side |

---

## Repository structure

```
plain/
├── backend/
│   ├── server.js              # Express entry point, route registration, CORS
│   ├── middleware/auth.js     # JWT verification → req.tenantId, req.employeeId
│   ├── routes/                # One file per domain, all protected by authMiddleware
│   ├── controllers/           # Thin: parse req, call service, return JSON
│   ├── services/              # All business logic lives here
│   ├── services_pdf_render.js # Playwright PDF renderer, Nunjucks env
│   ├── services_einvoice_*.js # XRechnung/CII/UBL builders
│   ├── templates/modern_a/   # Nunjucks PDF templates (invoice.njk, offer.njk, …)
│   └── migrations/            # SQL files — laufen im postdeploy-Hook (s. Deployment)
├── frontend-react/
│   └── src/
│       ├── api/               # One file per domain — apiClient wrappers + TypeScript types
│       ├── components/ui/     # Shared UI: Modal, Message, Autocomplete, …
│       ├── hooks/             # useCtrlS, …
│       ├── pages/             # Page components, one folder per domain
│       ├── store/             # Zustand auth store
│       └── utils/             # treeUtils (buildStructureTree, flattenTree), …
└── CLAUDE.md
```

---

## Backend architecture

**Pattern: route → controller → service**
- Routes register endpoints and pass the shared `supabase` client
- Controllers parse `req`, delegate to service, return `res.json()`
- Services contain all business logic; they never touch `req`/`res`

**Tenant isolation** is enforced at the application layer:
- `authMiddleware` decodes JWT → sets `req.tenantId`
- Every service function receives `tenantId` and must include `.eq('TENANT_ID', tenantId)` on every query
- Zusätzlich greift seit dem Scalingo-Umzug **RLS in der Datenbank** (`ENABLE`+`FORCE ROW LEVEL SECURITY`, Policy `"TENANT_ID" = current_tenant_id() OR is_system_request()`). Der Mandant kommt als JWT-Claim über PostgREST. Ein vergessenes `.eq('TENANT_ID', ...)` ist damit nicht mehr automatisch ein Leck — aber die Filter bleiben Pflicht, denn Hintergrunddienste laufen mit `sys`-Claim an der Policy vorbei.

**Error pattern** (services throw, controllers catch):
```js
// Service throws
throw { status: 400, message: 'Pflichtfeld fehlt' }

// Controller catches
} catch (e) {
  return res.status(e?.status || 500).json({ error: e?.message || String(e) })
}
```

**Datei-Uploads: multer braucht `keepScope`.** `tenantScope` spannt den
Mandanten mit `als.run()` auf — das trägt durch Promises und Timer, aber nicht
durch einen Handler, der seine Fortsetzung aus einem **Stream-Ereignis** heraus
aufruft. Genau das tut multer: busboy liest den multipart-Rumpf, die
`data`/`end`-Ereignisse löst der HTTP-Parser im Kontext des Servers aus. Alles
hinter `upload.single(…)` lief deshalb **ohne Mandanten-Claim**. Jeder
multer-Handler gehört in `keepScope(…)` aus `db.js`; geprüft von
`tests/uploadScope.test.js` (der Wächter dort findet auch eine neue
Upload-Route ohne Brücke).

Der Schaden war lange unsichtbar, weil **Lesen und Schreiben verschieden
scheitern**: der Import-Vorschau fehlte der Bestand, sie meldete „0 Dubletten"
statt eines Fehlers — plausibel aussehend und falsch. Erst der Schreibzugriff
fiel auf (`new row violates row-level security policy for table "IMPORT_BATCH"`).
**Ein fehlender Claim ist beim Lesen kein Fehler, sondern ein falsches
Ergebnis** — deshalb warnt `db.js` beim claimlosen Zugriff jetzt je
Aufrufstelle und je Minute samt Stapel, statt einmal je Prozessleben.

**Dateiablage — nie `fs.*`**: Dateien laufen ausschließlich über
`services/objectStorage.js` (`put` / `getBuffer` / `getStream` / `exists` /
`remove`), geschlüsselt über `STORAGE_KEY`. Auf Scalingo gibt es kein
dauerhaftes Dateisystem — ein `fs.writeFileSync` nach `backend/uploads/` ist
nach dem nächsten Deploy verschwunden. Erzeugte Belege (PDF/XML) laufen über
`services/generatedAssets.js`, nicht über eigene Kopien. Details:
`docs/OBJECT_STORAGE.md`.

---

## Frontend architecture

**API calls**: every domain has a file in `src/api/` that exports typed fetch functions using `apiClient` (axios wrapper). The pattern:
```ts
export const fetchOffers = () =>
  apiClient.get<{ data: OfferListItem[] }>('/angebote')
```

**Data fetching**: Tanstack Query (`useQuery` + `useMutation`). After a mutation succeeds, invalidate the relevant query keys.

**Forms**: controlled React state + `formRef.current?.requestSubmit()` for `useCtrlS` integration. No form library.

**Ctrl+S**: `useCtrlS(handler, enabled)` hook (`src/hooks/useCtrlS.ts`) — wires a global keydown listener. Use `enabled` to scope it (e.g. only when a modal is open).

**Modals**: `<Modal open={...} onClose={...} title="...">` from `@/components/ui/Modal`.

**Tree structures**: `buildStructureTree` + `flattenTree` from `@/utils/treeUtils` — used wherever PROJECT_STRUCTURE or OFFER_STRUCTURE is rendered as a hierarchy.

---

## RBAC — Permissions bei neuen Features

PlaIn hat ein vollständiges Role-Based Access Control System (siehe Migration `0062`, `docs/RBAC_DEVELOPMENT_CHECKLIST.md`).

**Regel für jede neue Funktionalität**:

1. Bevor ein neuer mutating Backend-Endpoint (POST/PATCH/PUT/DELETE) ergänzt wird ODER ein neuer sichtbarer UI-Button/Tab/Menüeintrag/sensibles Feld dazukommt:
   - Prüfen, ob im bestehenden Permission-Katalog (`backend/migrations/0062_rbac_foundation.sql`) eine passende Permission existiert.
   - **Falls ja**: bestehende Permission wiederverwenden — Backend mit `requirePermission(...)` gaten, Frontend mit `<Can permission="...">` oder `useFilterTabs` wrappen.
   - **Falls nein**: den User fragen. Beispielfrage: *„Soll für [Funktion X] eine eigene Permission `modul.aktion` angelegt werden, oder reicht die bestehende `xy.view`?"* — mit Default-Rollen-Empfehlung. Nicht stillschweigend offene Routen anlegen.

2. Wenn eine neue Permission nötig ist:
   - Neue Migration `0063_…` mit `INSERT INTO PERMISSION` (samt KEY, MODULE, ACTION, LABEL_DE, etc.)
   - Optional: `INSERT INTO ROLE_PERMISSION` für Default-Rollen, die sie bekommen sollen
   - Im Code: `requirePermission` Backend + `<Can>` Frontend
   - Den Permission-Key in `frontend-react/src/store/permissionsStore.ts` ergänzen, falls feste Listen geführt werden (z.B. SideNav, BottomNav, ProtectedRoute)

3. Schritt-für-Schritt-Anleitung mit Code-Vorlagen siehe `docs/RBAC_DEVELOPMENT_CHECKLIST.md`.

---

## In-Product-Hilfe — Tooltips bei neuen Features

Ziel: PlaIn bleibt **ohne Schulung nutzbar**. Hilfe/Tooltips laufen bei jeder neuen Funktion mit — genauso verbindlich wie die RBAC-Regel.

**Regel**: Wenn ein neues **Setting**, ein **Wizard-Schritt**, eine **Kennzahl/Report-Spalte**, ein **E-Rechnungs-/fachlich nicht-triviales Feld** oder eine **neue Liste/Ansicht** dazukommt — oder sich Bestehendes deutlich ändert:

1. **Erklärungsbedürftig?** Alles mit größerem Einfluss aufs System (Großteil der Einstellungen), alle Wizards (Rechnungen, Kalkulation), E-Rechnung, Reporting-Kennzahlen → ja. Selbsterklärende Standard-Interaktionen (Suche, „Speichern", offensichtliche Namensfelder) → nein.
2. **Hilfetext zentral pflegen**: prüfen, ob in `frontend-react/src/help/helpContent.tsx` schon ein Eintrag passt → via `<HelpHint id="…">` wiederverwenden. Sonst dort einen Eintrag (`"<modul>.<thema>"`) ergänzen und einbinden. Für rein lokale Einmal-Erklärungen `<InfoHint>` (freier Text). Spalten-Header tragen `help?: HelpId`.
3. **Neue Liste/Ansicht**: Leerzustand mit Hinweis — „noch keine Daten" (mit erster Aktion **+ Warum**) von „kein Treffer" (Suche/Filter) unterscheiden.
4. **Bei Funktionsänderung**: den zugehörigen Hilfetext mit aktualisieren.

Bausteine, Architektur, priorisierte Coverage-Map und Wording-Regeln: `docs/HELP_TOOLTIP_CONCEPT.md`.

---

## Database conventions

| Convention | Example |
|---|---|
| Table + column names | `UPPER_CASE` (`OFFER`, `NAME`, `ABBR`) |
| API request body fields | `snake_case` (`name_long`, `offer_status_id`) |
| Currency rounding | Always `fmt2(n)` = `Math.round(n * 100) / 100` |
| Hierarchy | `FATHER_ID` column; insert all rows with `FATHER_ID=null` first, then update — the **2-pass pattern** |
| Soft delete | Not used — hard deletes only |
| Tenant isolation | Every table has `TENANT_ID`; every query must filter by it |
| `.upsert()` | **`TENANT_ID` gehört immer in die Nutzlast** — auch wenn nur aktualisiert wird |

**Warum `.upsert()` ohne `TENANT_ID` bricht**: PostgREST übersetzt `.upsert()` in
`INSERT … ON CONFLICT DO UPDATE`. Die RLS-Policy prüft `WITH CHECK` gegen die
**vorgeschlagene** Zeile, nicht gegen die gespeicherte. Fehlt der Mandant, ist er
dort `NULL`, der Vergleich ergibt `NULL` statt `true`, und die Datenbank antwortet
mit `new row violates row-level security policy for table "…"`. Unter dem alten
Supabase-Service-Key fiel das nicht auf — der umging RLS. Migration `0131` setzt
zusätzlich `DEFAULT public.current_tenant_id()` auf jede `TENANT_ID`-Spalte als
Netz darunter. Reine `.update()`-Aufrufe sind nicht betroffen (die Zeile behält
ihren Mandanten).

**Migrationen laufen ohne Mandanten-Claim — RLS blockiert sie fail-closed.**
Ein `psql`-Lauf trägt kein JWT. Jede Migration, die eine Tabelle mit
`TENANT_ID` **liest** oder **schreibt**, sieht deshalb null Zeilen und meldet
trotzdem Erfolg. Genau so ist Migration `0136` beim ersten Einspielen ins
Leere gelaufen: `INSERT INTO "ROLE_PERMISSION" … SELECT FROM "USER_ROLE"` fand
keine Rolle, die neue Permission hing an niemandem, und der Report war für
alle unsichtbar — ohne eine einzige Fehlermeldung.

Deshalb an den Anfang jeder solchen Migration:

```sql
SET request.jwt.claims = '{"sys":"true"}';   -- is_system_request() → true
-- … INSERT/UPDATE/SELECT auf mandantenbezogene Tabellen …
RESET request.jwt.claims;
```

Reines DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE FUNCTION`) und globale
Kataloge ohne `TENANT_ID` (`PERMISSION`, `CAPABILITY_PERMISSION`,
`LICENSE_*`) brauchen das nicht. Und: **nach dem Einspielen gegenprüfen** —
mit gesetztem Claim, sonst prüft man dieselbe Blindheit noch einmal.

**Generierte Seeds**: wer eine Permission an eine Lizenz-Capability hängt,
ändert `capabilities.manifest.js` und lässt `npm run license:gen` laufen — das
Einspielen von `0070b` übernimmt der Deploy-Hook, weil die Datei
`-- @repeatable` trägt und über ihren Inhalts-Hash läuft. **Die generierte
Datei mit committen**: bleibt sie liegen, ändert sich der Hash nicht und die
Zeile in `CAPABILITY_PERMISSION` entsteht nie — das Recht gilt dann als
„keiner Capability zugeordnet" und wirkt in jedem Tarif (fail-open). Genau
diese Kette prüft `backend/tests/migrate.plan.test.js` mit.

**Neue Mandanten bekommen ihre Rollen nicht aus den Migrationen**, sondern aus
`seedTenantRbacAndAssignAdmin` in `routes/auth.js`. Dort vergibt „Projektleiter"
pauschal alles aus `MODULE IN (…, "reports", …)`. Eine neue Permission in einem
dieser Module fällt also automatisch an den Projektleiter — wenn das nicht
gewollt ist, in `nichtFuerProjektleiter` eintragen.

**Key tables**: `TENANTS` (die Mandantentabelle heisst im Plural — `TENANT` gibt
es nicht), `COMPANY`, `EMPLOYEE`, `ADDRESS`, `CONTACT`, `PROJECT`, `PROJECT_STRUCTURE`, `PROJECT_PROGRESS`, `EMPLOYEE2PROJECT`, `CONTRACT`, `INVOICE`, `ADVANCE_INVOICE`, `BOOKING`, `OFFER`, `OFFER_STRUCTURE`, `BILLING_TYPE`, `ROLE`, `VAT`, `TENANT_SETTINGS`, `WIP_CLOSING`/`WIP_CLOSING_LINE`.

**BILLING_TYPE_ID**: `1` = fixed-fee (Pauschal), `2` = hourly (Stunden, nach Aufwand).

**Eindeutigkeit gehört mandantenweit gedacht — oder gar nicht.** Eine
`UNIQUE`-Regel wirkt **vor** den Policies und kennt keine Mandanten. Steht sie
auf einem Wert, den der Mandant selbst vergibt, sperrt sie fremde Büros aus
*und* verrät sie: `ADDRESS_NAME_1` war so belegt, und der Fehler
„duplicate key" sagte einem Mandanten, dass ein anderer diesen Kunden führt
(Migration `0164`). RLS verbirgt die Zeile, der Index nicht.

Zulässig ist so eine Regel nur, wenn der Wert **nicht** dem Mandanten gehört:
weil sie an einem Fremdschlüssel hängt, der schon zu genau einem Mandanten
führt (`UNIQUE (INVOICE_ID)` ist damit automatisch mandantenweit), oder weil
der Wert von Natur aus global eindeutig ist (`PUSH_SUBSCRIPTION.ENDPOINT`).
Sonst gehört `TENANT_ID` in die Spaltenliste — und wenn das Produkt Dubletten
ausdrücklich zulässt (wie beim Adressimport: „trotzdem neu anlegen"), gehört
die Prüfung ganz in die Anwendung, wo sie fragen kann statt nur abzuweisen.

**Globale Kataloge tragen keinen Mandanten**: `CURRENCY`, `VAT`, `COUNTRY`,
`PROJECT_STATUS`, `OFFER_STATUS`, `PAYMENT_MEANS`. Sie werden **ohne**
`.eq("TENANT_ID", …)` gelesen — ein Filter darauf liefert nicht etwa alles,
sondern einen PostgREST-Fehler, und wer ihn wegfängt, bekommt stillschweigend
eine leere Liste. Genau so stand monatelang ein `vat: null` im Demo-Seed
(`demo/seed/lib/masterData.js`).

`PAYMENT_MEANS` ist seit Migration `0163` zusätzlich **schreibgeschützt**: die
Werte sind die Codeliste UNTDID 4461 (`einvoice/codelists.js`), `ABBR` trägt
den Code. Die Policy lässt Lesen für alle zu, Schreiben nur mit `sys`-Claim —
also nur aus einer Migration. Der Mandant wählt daraus eine Vorbelegung
(`default_payment_means_id`), mehr nicht. Das ist die Form für jeden weiteren
Katalog, den der Betreiber und nicht das Büro definiert; **ohne `FORCE` wäre
der Schutz wirkungslos**, weil PostgREST sich als Tabelleneigentümer verbindet
und an jeder Policy vorbeigeht.

**Namensumstellung 2026-09 — alte Namen in aelteren Texten.** Tabellen und
Spalten wurden systemweit umbenannt (acht Bloecke, Migrationen 0140–0159).
Aeltere Migrationen, Dokumente und Kommentare nennen noch die alten Namen; das
ist Historie und bleibt so. Die Zuordnung:

| alt | neu |
|---|---|
| `TEC` / `TEC_REBOOKING` | `BOOKING` / `BOOKING_REBOOKING` |
| `PARTIAL_PAYMENT` / `_STRUCTURE` | `ADVANCE_INVOICE` / `_STRUCTURE` |
| `EMPLOYEE_CP_RATE`, `PROJECT_SP_RATES` | `EMPLOYEE_COST_RATE`, `PROJECT_HOURLY_RATES` |
| `NAME_SHORT`, `SHORT_NAME` | `ABBR` |
| `NAME_LONG` | `NAME` |
| `SP_RATE`, `SP_TOT` | `HOURLY_RATE`, `HOURLY_RATE_TOTAL` |
| `CP_RATE`, `CP_TOT` | `COST_RATE`, `COST_TOTAL` |
| `DATE_VOUCHER`, `TEC_ID` | `BOOKING_DATE`, `BOOKING_ID` |
| `ROLE_NAME_SHORT`, `ROLE_NAME_LONG` | `ROLE_ABBR`, `ROLE_NAME` |

**Bei einer weiteren Umbenennung**: `backend/scripts/rename/` benutzen, nicht
von Hand ersetzen. Ablauf und Fallstricke stehen in `docs/RENAME_BEFUNDE.md`.
Der CI-Job `rename-guard` faengt einen Altnamen, der zurueckkommt.

Drei Dinge, die dabei teuer waren und die kein Werkzeug von selbst sieht:
- **Derselbe String kann ein WERT sein.** `PARTIAL_PAYMENT` stand als
  `doc_type` in `document_number_range` — ein unbekannter Wert laesst
  `next_document_number()` bei 1 anfangen, also doppelte Rechnungsnummern.
  Vor jeder Umbenennung die Datenbank nach gespeicherten Vorkommen absuchen.
- **`CREATE OR REPLACE FUNCTION` kann Ausgabespalten nicht umbenennen.** Wo die
  `RETURNS TABLE`-Signatur betroffen ist, muss die Funktion fallen und neu
  entstehen.
- **Der Codemod ersetzt an Wortgrenzen.** `PDF_PARTIAL_PAYMENT` und
  `DEFAULT_CP_RATE` bleiben deshalb stehen — das eine war ein Fehler, das
  andere richtig.

---

## Key business domain patterns

- **Offer → Project conversion** (`POST /angebote/:id/convert`): creates PROJECT + PROJECT_STRUCTURE + EMPLOYEE2PROJECT + CONTRACT from OFFER data. REVENUE/EXTRAS only copied to PROJECT_STRUCTURE if `BILLING_TYPE_ID = 1`; BT=2 nodes start at 0 — ihre Schätzung geht als **Plan** mit (`PLAN_HOURS`/`PLAN_REVENUE`, Migration `0173`, abwählbar mit `transfer_plan: false`).
- **Aufwandszeilen** (Migration `0173`): ein Angebotselement nach Aufwand trägt `EFFORT_LINES` (Rolle · Stunden · Satz, beliebig viele), das Honorar ist die Summe. `QUANTITY`/`HOURLY_RATE`/`ROLE_*` werden daraus abgeleitet (Satz und Rolle nur bei genau einer Zeile); `EFFORT_LINES = NULL` ist Altbestand und gilt als eine Zeile. Prüfen, ableiten und lesen **nur** über `services/effortLines.js` (`normalizeEffortLines`, `effortColumns`, `nodeEffortLines`) — Speichern, PDF, Auftragsbestätigung und Beauftragen gehen alle hindurch. Im Frontend dasselbe über `nodeLines`/`effectiveLines` in `offerStrukturCalc.ts`.
- **Plan am Projekt-Element**: ein Blatt nach Aufwand mit `PLAN_REVENUE` rechnet in der Budgetwarnung mit dem Plan als Budget und dem **gebuchten Honorar** (Σ `HOURLY_RATE_TOTAL` bestätigter Buchungen) als Verbrauch (`services/budgetWarnings.js`). Ohne Plan bliebe das Budget die Summe der Buchungen selbst und könnte nie warnen. Geändert wird der Plan über `PATCH /projekte/structure/:id/plan` (`projects.structure.edit`) — **nicht** über `patchStructure`, das bei jedem Aufruf einen Leistungsstand-Snapshot schreibt.
- **Invoice wizard**: draft invoice → assign performance amount + bookings → generate line items → finalize.
  Abschlag, Einzelrechnung und Gutschrift laufen durch **einen** Assistenten
  (`pages/rechnungen/InvoiceWizard.tsx`); was sich je Belegart unterscheidet
  (Endpunkte, Datumsfeld, Sicherheitseinbehalt nur beim Abschlag), steht in
  `wizardApi.ts`. Die Schlussrechnung hat zwei Schritte mehr und bleibt eine
  eigene Datei im selben Muster. Summen (Nachlass I/II, Skonto, MwSt., SE)
  rechnet **nur** `invoiceTotals.ts` — Anzeige, Speichern, PDF, XML und Buchen
  nehmen dieselbe Nutzlast. PDF und XML speichern vorher die Nachlässe. Die
  Auswahl der aufzulösenden Sicherheitseinbehalte einer Schlussrechnung merkt
  sich der Entwurf in `INVOICE.SE_RELEASE_ADVANCE_IDS` (Migration `0171`);
  maßgeblich beim Buchen bleibt, was der Buchungsaufruf mitschickt.
  **Buchungsauswahl** (`components/rechnungen/BuchungsauswahlTable.tsx`, Logik in
  `buchungsauswahl.ts`): Filter sind eine Ansicht, abgerechnet wird jede
  angehakte Buchung — auch eine ausgeblendete (die Zählzeile sagt „davon n
  ausgeblendet"); die einzige Brücke ist „Nur sichtbare auswählen".
  „0-Beträge mitabrechnen" gilt für jede Sammelaktion und die Vorauswahl.
  Gemerkt werden nur Vorlieben, nicht Suche/Datum/Mitarbeiter/Leistung.
  Der Stichtag „Seit letzter Rechnung" kommt vom Server
  (`services/bookingSelection.js`, in `GET …/tec` als `last_invoice`): letzte
  gebuchte Abschlags-/Einzel-/(Teil-)Schlussrechnung des Vertrags, Ende des
  Leistungszeitraums, sonst Belegdatum — Stornos und Korrekturen zählen nicht.
  In der **Schlussrechnung** stehen die offenen Buchungen der gewählten
  Positionen nach Aufwand unter den Positionen; `POST /final-invoices/:id/phases`
  nimmt `booking_ids` mit, ordnet sie zu (`INVOICE_ID`) und zieht abgewählte
  samt Nebenkosten von der Position ab (`phaseRemaining`, im Assistenten
  `thisInvoiceOf`). Per Abschlag abgerechnete Buchungen bleiben in der Position
  (Restrechnung, Schritt 4 zieht ab). Ohne `booking_ids` gelten alle offenen
  als gewählt. Vorher ordnete die Schlussrechnung keine Buchung zu — sie
  blieben offen und standen in der nächsten Einzelrechnung erneut zur Wahl.
- **Projekt- und Angebotsstruktur** teilen Bedienung und Rechnung: Summen
  (Honorar-Basis, Zuschlaege, NK je Vater) rechnet **nur**
  `pages/projekte/struktur/strukturCalc.ts` (`aggregateTree`,
  `treeRootTotals`); `pages/angebote/struktur/offerStrukturCalc.ts` legt nur
  fest, was beim Angebot anders ist (Blatt-Basis ohne Buchungen, Aufwand =
  Stunden × Satz, Speicher-Nutzlast kleingeschrieben plus `SURCHARGE_*` in
  einem PUT). Beide Tabellen puffern Eingaben bis „Speichern" (ActionBar,
  `useRegisterDirty`); Anlegen, Loeschen, Verschieben wirken sofort. Beide
  sind immer luftig (keine Dichte-Umschaltung); welche Spalten sichtbar sind,
  waehlt jeder ueber „Spalten" (`struktur/strukturSpalten.ts`, je Mitarbeiter
  gemerkt). Ein
  Angebotselement mit Unterelementen loescht das Backend nicht
  (`dependencyCheck.checkOfferStructure`, 409) — die Oberflaeche sagt das
  vorher, statt es „samt Unterelementen" zu versprechen.
- **Angebote als Arbeitsbereich** (wie die Projekte): `/angebote` ist die
  Liste, `/angebote?offerId=…&tab=struktur|kalkulationen|daten` das Angebot
  mit Kopf (`AngebotHeader.tsx`: Name als Umschalter, Strg+K) und Reitern.
  Der Zustand steht in der URL (`angebote/angebotUrlState.ts`); Links von
  anderen Seiten bauen `angebotHref(id, tab)`, alte `state: { offerId }`-
  Einstiege werden umgeschrieben. „Als beauftragt markieren" laeuft in Liste
  und Kopf ueber denselben `BeauftragtDialog`.
  Reiter „Angebotsdaten" (`Angebotsdaten.tsx`, lesbar mit `offers.view`,
  änderbar mit `offers.edit`) und „Neues Angebot" (`AngebotAnlegenDialog.tsx`)
  teilen die Felder aus `OfferFields.tsx` samt `missingOfferFields`/
  `offerPayload`. Die Person im Büro heißt dort „Zuständig" (im PDF
  „Ansprechpartner"), die beim Kunden „Kontakt". Der Server prüft beim Anlegen
  und Ändern, dass die Adresse dem Mandanten und der Kontakt genau dieser
  Adresse gehört (`assertOwnAddress`/`assertContactOfAddress`,
  `services/adressen.js`); Pflichtfelder dürfen sich ändern, aber nicht leeren.
  Kopf- und Fußtext bleiben beim Anlegen leer: das PDF nimmt dann den
  Standardtext aus `TEXT_TEMPLATE` (`offer_angebot`, Einstellungen →
  Dokumentvorlagen), das Formular zeigt ihn grau im Feld. Eine zweite
  Vorlage unter den Vorbelegungen gibt es bewusst nicht.
- **Kalkulationen (HOAI-Assistent)** (`pages/projekte/HonorarWizard.tsx`, Liste
  `HonorarTab.tsx`, im Angebot `angebote/AngeboteHoai.tsx`): im Muster der
  Rechnungsassistenten — sprechende Schritte, ActionBar (im Dialog am unteren
  Rand), „Weiter" **und** „Zurück" speichern den Schritt. Eine neue Kalkulation
  gilt erst mit „Übernehmen" als angelegt; wer vorher geht, verwirft sie
  (Unmount-Cleanup), und die Rückfrage sagt genau das. Dialoge mit dem
  Assistenten schließen über `guarded(close, [HONORAR_WIZARD_GUARD])` — `only`
  beschränkt die Rückfrage auf den Assistenten statt auf die Tabelle dahinter.
  Im Angebot ohne gewähltes Element legt `addFeeCalcToOffer` ein eigenes auf
  oberster Ebene an: `ATTACH_TO_OFFER_STRUCTURE_ID` ist der Anker, an dem das
  Beauftragen erkennt, dass die Phasen schon in der Struktur stehen — direkt an
  der Wurzel legte es sie ein zweites Mal an. Elemente aus einer Kalkulation
  tragen `FEE_CALC_MASTER_ID` + `FEE_CALC_PHASE_ID`/`FEE_CALC_BL_ID` — im
  Projekt seit 0041/0043, im Angebot seit `0174`; beim Beauftragen geht die
  Verknüpfung mit. Daran hängen „Struktur aktualisieren" bzw. „Angebot
  aktualisieren" (`POST …/sync-to-structure`, Ziel je nachdem, ob die
  Kalkulation schon am Projekt hängt). Beide rechnen über
  `services/feeAllocation.js` (`computeSurchargeAllocations`, `leafValues`):
  Phase + Zuschlagsanteil, darauf die **eigenen** Zuschläge und NK des
  Elements, `REVENUE_BASIS` zieht mit.
  Die Rechnung des Assistenten (Kx, Phasenhonorar, Besondere Leistungen,
  Zuschläge) steht **nur** in `pages/projekte/kalkCalc.ts`. Am Handy zeigen
  Leistungsphasen, Besondere Leistungen und Zuschläge eine Liste, ein Tipp
  öffnet die Zeile als Blatt (`KalkMobile.tsx`); „Übernehmen" schreibt in den
  Stand des Assistenten, gespeichert wird wie am Desktop mit Weiter/Zurück.
- **Projektdaten** (`/projekte?projectId=…&tab=daten`, `Projektdaten.tsx`):
  Name, Nummer, Status, Leitung, Auftraggeber, „intern" im Arbeitsbereich-
  Muster. Der Stift der Projektliste führt dorthin — einen Bearbeiten-Dialog
  in der Liste gibt es nicht mehr. Die Folgefragen (Auftraggeber auch in den
  Vertrag, „intern" an die Elemente) kommen **nach** dem Speichern und nur,
  wenn sie etwas ändern. Das Kennzeichen „intern" am Projekt wirkt auf die
  Produktivität; Rechnungen lassen nur **Elemente** aus, die selbst intern sind.
- **Gesamtprojekte** (Migration `0181`, `services/gesamtprojekte.js`,
  `pages/projekte/gesamtprojekt/`, Konzept `docs/GESAMTPROJEKT_CONCEPT.md`):
  mehrere Projekte (Einzelverträge: Stufen, Nachtrag als eigener Vertrag,
  zweiter Rechnungsempfänger) als ein Vorhaben. Eine **Klammer, kein
  Beleg-Träger** — Vertrag, Rechnungen, Buchungen, Leistungsstände bleiben am
  Projekt; ein Projekt gehört zu höchstens einem Gesamtprojekt
  (`PROJECT.PROJECT_GROUP_ID`). Zuordnen **nur** über `assertOwnGroup`, der
  Fremdschlüssel prüft den Mandanten nicht. Summen: Beträge addieren, Quoten
  **aus den Summen** (`aggregateKpis`, im Report dieselben `renderTotal`), und
  nur über Projekte im Reporting-Scope — `/reports/groups/:id/summary` sagt
  „n von m", die Beträge der übrigen verlassen den Server nicht. Recht:
  `projects.edit` (keine eigene Permission). `copyProject` übernimmt die
  Zuordnung (Folgeprojekt). Listen lesen sie über
  `groupsByProjectIfMigrated` — der Web-Container startet vor dem
  postdeploy-Hook. Neue Projekte (Neuanlage, Beauftragen, Kopieren) gehen
  **nur** über `newProjectGroupAndAbbr`: Gesamtprojekt prüfen und eine
  vorgegebene (abgeleitete) Nummer auf Dubletten, **bevor** der Nummernkreis
  gezogen wird; `PROJECT_GROUP_ID` nur in die Zeile, wenn gewählt.
  Leistungsphasen je Gesamtprojekt: `/reports/phases/matrix?group_id=`.
  Auf Belegen (Rechnung, Storno, Mahnung, Nachtrag) steht der Name als
  „Bauvorhaben: …" und als Platzhalter `{{bauvorhaben}}` — beides **nur**
  über `bauvorhabenForProject`; abschaltbar mit `theme.header.showBauvorhaben`
  (Vorlagen prüfen `!= false`, alte Vorlagen kennen den Schlüssel nicht).
- **Adressen als Arbeitsbereich** (`/adressen/:id?tab=kontakte|daten|verwendung`,
  `pages/adressen/AddressDetailPage.tsx`): Kopf mit Anschrift/Telefon/E-Mail,
  Reiter Kontakte · Adressdaten · Verwendet in. Bearbeitet wird **nur** dort
  (Stift, „Zuletzt verwendet" und alte `state.openAddressId`-Einstiege führen
  hin); Felder einmal in `AddressFields.tsx`, Kontakte über `ContactDialog.tsx`
  (Liste und Seite), Neuanlage über `AddressCreateDialog.tsx` mit Rückfrage bei
  gleichem Namen (seit `0164` keine UNIQUE-Regel mehr). Welche Belege an einer
  Adresse hängen, rechnet `services/adressen.js` (`addressLinks`, je Recht des
  Moduls); die Löschprüfung steht in `dependencyCheck.js` und wird von
  `tests/dependencyCheck.columns.test.js` gegen das Schema gehalten.
  Rechnungen führen die Adresse als `INVOICE_ADDRESS_ID`, Abschläge als
  `ADVANCE_INVOICE_ADDRESS_ID` — nicht `ADDRESS_ID`. Je Adresse gibt es einen
  Hauptansprechpartner (`ensureSinglePrimary`). Wer in Projekt, Angebot oder
  Vertrag eine Adresse **wählt**, bekommt ihn als Kontakt vorbelegt (sonst den
  einzigen Kontakt der Adresse) — über `useContactPreset`, nie beim Laden
  eines gespeicherten Stands; `GET /stammdaten/contacts/by-address` liefert
  dafür `IS_PRIMARY` und stellt ihn nach vorn.
- **Mitarbeiter als Arbeitsbereich** (`/mitarbeiter/:id?tab=stammdaten|arbeitszeit|kostensatz|zeitkonto|abwesenheit|projekte|rollen|zugang`,
  `pages/mitarbeiter/MitarbeiterDetailPage.tsx`, UI-Pilot Runde 10): Kopf mit Kontakt, Kostensatz
  (nur `employees.salary.view` + Tarif) und Saldo (nur `employees.bookings.view_all`), Reiter je Recht.
  Einen Bearbeiten-Dialog gibt es nicht mehr; Liste, Rollen-Abzeichen und Neuanlage führen hin
  (`mitarbeiterHref`). Einen Einzelabruf gibt es am Server nicht — die Seite liest aus der Liste
  (`['employees']`). `PATCH /mitarbeiter/:id` ist ein **Teil-Update**: Stammdaten und die
  Direktbearbeitung der Liste schicken nur geänderte Felder. Datierte Verläufe (Arbeitszeitmodell,
  Kostensatz) laufen über eine Tabelle (`EmployeeHistory.tsx`); je Tag gibt es höchstens einen
  Eintrag (409). Das Zeitkonto ändert eine Buchung nur mit `projects.bookings.edit/delete`, nie eine
  abgerechnete, und zieht `QUANTITY_EXT` nur mit, solange es `QUANTITY_INT` entsprach.
  Stundencontrolling zeigt Auswertung und Einzelansicht nur mit `employees.bookings.view_all`; wer
  nur `employees.month_close.edit` hat, sieht den Monatsabschluss.
- **Abwesenheiten und Stundencontrolling** (Modul Mitarbeiter, UI-Pilot Runde 11):
  Unterreiter in der URL — `?tab=abwesenheiten&sub=inbox|calendar|my|entitlements`
  (`pages/mitarbeiter/AbwesenheitenTab.tsx`, Benachrichtigungen verlinken mit `&absence=…`) und
  `?tab=zeitwirtschaft&sub=single&emp=…` (`Stundencontrolling.tsx`). Beantragen, Bearbeiten und
  Erfassen laufen durch **einen** Dialog (`AbsenceDialog.tsx`); was ein Antrag kostet, rechnet
  `GET /abwesenheit/preview` am Server wie das Speichern (Modell, Feiertage, je Jahr, Resturlaub
  danach samt offener Anträge, Überschneidungen mit eigenen Einträgen) — nie im Browser nachbauen.
  Eine Überschneidung mit einem eigenen beantragten oder genehmigten Eintrag lehnt der Server beim
  eigenen Antrag ab (`findOverlaps`, 409 bei POST und PATCH; die Vorschau meldet `overlap_blocks`);
  mit `absence.manage` bleibt es eine Warnung — etwa für eine Krankmeldung mitten im Urlaub.
  Genehmigen, Ablehnen (mit Begründung → `DECISION_NOTE`) und Rückfrage über `AbsenceDecision.tsx`;
  Status, Zeitraum, Tage und Verlauf über `absenceUi.tsx`. Den Resturlaub liefert
  `vacationBalanceFor` in `routes/abwesenheit.js` (auch `pending` = offen beantragt). Die Seite hat
  einen DirtyGuard: offene Urlaubsansprüche fragen beim Wechsel von Reiter oder Unterreiter.
- **Einstellungen** (`/admin?tab=…&sub=…`, UI-Pilot Runde 12): Reiter und Unterreiter stehen in der URL,
  die Seite hat einen DirtyGuard. Vorbelegungen (`pages/admin/VorbelegungenPage.tsx`) im Muster der
  Seitenformulare: Eingaben über dem geladenen Stand, gespeichert werden **nur geänderte** Schlüssel in
  einem `PUT /stammdaten/defaults` mit `{ values }`; Zahlen nehmen „2,5". Stammdaten
  (`pages/admin/StammdatenPage.tsx`) je Katalog ein Unterreiter (am Handy eine Auswahl); Löschen fragt
  nach, und die 409 der Löschprüfung bleibt als Meldung stehen. Bearbeiten je Katalog mit dessen Recht
  (`settings.basedata.edit`, `settings.booking_types.edit`, `settings.booking_text_templates.edit`,
  `absence.manage`, `settings.work_time.edit`) — ohne Recht nur lesen.
- **Nachträge** (`services/nachtraege.js`, Liste `pages/nachtraege/NachtraegeListe.tsx` im Modul und im
  Projekt-Reiter, Detail `NachtragDetail.tsx`): Positionen werden je Blatt ins Projekt **freigegeben**
  (Knoten unter „Nachträge" in `PROJECT_STRUCTURE`). Eine freigegebene Position — `APPROVED`, auch
  gekürzt `PARTIAL`, bzw. mit `RELEASED_STRUCTURE_ID` — ist erledigt: nicht erneut freigebbar, im
  Nachtrag nicht mehr änderbar oder löschbar (409), Korrekturen laufen im Projekt. Dieselbe Regel
  steht einmal im Backend (`isReleased`) und einmal im Frontend (`nachtragStatus.ts`). Positionen
  nach Aufwand starten im Projekt bei 0 und bringen ihre Schätzung als Plan mit (wie beim
  Beauftragen); Rollen gehen **nicht** in die Projektstruktur, die hat keine Rollenspalten.
  Die Freigabe hat ein **Ziel** (Migration `0182`): wie bisher das Projekt des Nachtrags, ein
  **eigenes Projekt** im Gesamtprojekt (`createReleaseProject`: Firma, Team, Vertragskonditionen
  vom Ursprung über `inheritedContractTerms`, Rechnungsempfänger aus dem Dialog; ohne
  Gesamtprojekt entsteht eins) oder ein Projekt aus einer früheren Freigabe **desselben**
  Nachtrags. `NACHTRAG_RELEASE.TARGET_PROJECT_ID` hält das fest; der Nachtrag bleibt an seinem
  Projekt. Rechte: `projects.create` (+ `projects.edit`, wenn ein Gesamtprojekt entsteht), alles
  geprüft vor dem ersten Schreiben.
- **Abschlags- vs. Schlussrechnung**: handled by `INVOICE_TYPE` field; final invoices deduct all prior partial payments.
- **Offener Betrag — eine Rechnung** (`backend/services/openAmount.js`): Forderung
  = Brutto **nach** Nachlass I/II (gespeichert ist `TOTAL_AMOUNT_GROSS` **vor**
  Nachlass) − Einbehalt (+ aufgelöster Einbehalt); offen = Forderung − Zahlungen −
  ausgebuchte Reste; Skontozahlung innerhalb der Frist erledigt den Beleg.
  Rechnungsliste (`OPEN_AMOUNT_GROSS` aus `listInvoices`/`listPartialPayments`),
  Mahnwesen samt Mahnungs-PDF, Fälligkeits- und Mahn-Checker, Dashboard „Offene
  Posten" und E-Mail-Platzhalter lesen **nur** daraus — vorher rechneten sechs
  Stellen selbst, und nur die Liste kannte Nachlass, Einbehalt und Skonto. Nie
  wieder `TOTAL_AMOUNT_GROSS − Σ PAYMENT` von Hand; select-Listen über
  `withClaimCols(kind, …)`. Den Nachlass rechnet **nur**
  `services/documentDiscounts.js` (PDF, XML als BG-20 und offener Betrag — mit dem
  Vorzeichen des Belegs); `DISCOUNT_1/2` als Beträge schreibt kein Code. Steuer gibt
  es nur bei Kategorie **S** (`effectiveVatPercent`): `VAT_PERCENT` hält auch bei
  Reverse-Charge den Satz des Vertrags. Mehr als offen nimmt `POST /payments` nur mit
  `allow_overpayment` an (sonst 409 `OVERPAYMENT`); Zahlungen löschen — einzeln wie
  beim Storno — nur über `services/paymentRemoval.js`.
- **Rest ausbuchen** (`RECEIVABLE_ADJUSTMENT`, Migration `0177`,
  `services/receivableAdjustments.js`, `/payments/adjustments`, Rechte wie die
  Zahlungen): akzeptierte Kürzung ohne Storno (Entgeltminderung nach § 17 UStG,
  keine Rechnungsberichtigung nötig — BMF 15.10.2025 Rn. 51a). Grund Pflicht;
  „wieder abrechenbar" nur bei „Kürzung" auf Abschlags- und Einzelrechnungen und
  nur auf Honorar-Zeilen (BT 1): dann schreibt es `INVOICED`/`ADVANCE_INVOICED`
  an Projekt und Struktur plus `PROJECT_PROGRESS` fort wie ein Storno, und die
  „bisher abgerechnet"-Summen der Rechnungsvorschläge ziehen es ab
  (`rebillableByStructure`). Ein Storno nimmt die Reste des Belegs mit
  (`removeForCancelledDoc`); Zurücknehmen ist gesperrt, sobald danach wieder
  abgerechnet wurde. UI: `pages/rechnungen/ZahlungDialog.tsx`. Analyse und
  Rechtslage: `docs/RECHNUNGSKUERZUNGEN_ANALYSE.md`.
- **Schlussrechnung = Restrechnung** (UStAE 14.8 Abs. 11): gespeichert ist
  `TOTAL_AMOUNT_NET` = Positionen − Abzüge. Der Abzug je Abschlag ist das
  **Gezahlte** plus endgültige Minderungen und kommt **nur** vom Server
  (`services/arDeduction.js`; `saveDeductions` übernimmt keinen Betrag vom
  Client). Offener Rest, Einbehalt und „wieder abrechenbar" stehen damit in der
  Schlussrechnung; eine separate Einbehalts-Auflösung gibt es nur noch für
  Abschläge, die diese Rechnung nicht abzieht. Beim Buchen gleicht
  `refreshDeductions` ab (Zahlung seit dem Entwurf → 409), und die Abschläge
  werden `ABSORBED_BY_INVOICE_ID` (Migration `0178`): offen 0, keine Zahlung
  und kein Ausbuchen mehr darauf; ein Storno der Schlussrechnung leert es. Im
  XML stehen die Abzüge als Positionen mit negativer Menge, BT-113 bleibt 0 —
  vorher zog BT-113 sie ein zweites Mal ab (BR-CO-13).
- **Rechnungskorrektur** (früher „Gutschrift"; `INVOICE_TYPE` bleibt
  `'gutschrift'`, Recht `invoices.create_credit`, Migration `0179`,
  `services/invoiceCorrection.js`, UI `pages/rechnungen/KorrekturDialog.tsx`):
  immer mit Bezug auf einen gebuchten Beleg (`CORRECTS_INVOICE_ID` /
  `CORRECTS_ADVANCE_INVOICE_ID` — **nie** `CANCELS_INVOICE_ID`, das setzt beim
  Buchen das Original auf storniert) und Pflichtgrund (`CORRECTION_REASON`,
  steht auf dem PDF). Beträge **negativ** wie Storno und Belegimport, keine
  Fälligkeit, nie offen; mindert den offenen Betrag des Originals
  (`openAmount.js`) und — bei Abschlägen — deren Abgerechnetes, nicht das der
  Schlussrechnungen (`advanceCorrectionIds`). E-Rechnung: Belegart **384** mit
  BT-25 (381 bräuchte im UBL eine CreditNote-Wurzel). **Vorzeichen im XML**:
  Summen wie gespeichert, je Position Einzelpreis positiv und Menge mit dem
  Vorzeichen — vorher spiegelte `loadInvoiceData` den negativ gespeicherten
  Storno ein zweites Mal (positive Summen, negativer Einzelpreis, BR-27).
- **Stornieren und neu ausstellen** (`services/reissue.js`, Migration `0180`,
  `POST /invoices|partial-payments/:id/reissue`, Recht `invoices.cancel` **plus**
  das Anlege-Recht der Belegart): Storno wie bisher (Zahlungen bleiben stehen)
  und ein Entwurf als Kopie — Positionen, Buchungen, bei Schlussrechnungen die
  Auswahl der Abzüge und der SE-Freigabe; Datum heute, gleiches Zahlungsziel,
  `REPLACES_INVOICE_ID` / `REPLACES_ADVANCE_INVOICE_ID` zeigt aufs Original
  (PDF-Hinweis, BT-25). Die Zahlungen samt `PAYMENT_STRUCTURE` wandern erst
  **beim Buchen** (`transferReplacedPayments` in `bookInvoice`,
  `bookFinalInvoice`, `bookPartialPayment`) — ein Entwurf ohne Nummer trägt
  keine Zahlung, und verworfen bleibt alles wie nach einem Storno. Der Storno
  eines Ersatzbelegs erbt `REPLACES_*` **nicht**. Nicht für
  Rechnungskorrekturen und nicht für in einer Schlussrechnung aufgegangene
  Abschläge.
- **Mahnungen archiviert** (Migration `0183`, `services/mahnungenService.js`): jede gesetzte Mahnstufe und jeder Versand legt das PDF als `ASSET` (`PDF_DUNNING`) ab, `MAHNUNG_HISTORY.PDF_ASSET_ID` verweist darauf, `GET /mahnungen/history/:id/pdf` liefert die Kopie. Ein normaler PDF-Abruf rendert neu (heutiges Datum, heutiger offener Betrag) — das ist eine neue Mahnung, keine Kopie des Briefs (§ 257 HGB). Beim Versand gilt: ohne Ablage kein Versand, ohne Versand keine Ablage. Die Mahnliste liest den Verlauf mit `select("*")`, weil der Web-Container vor dem postdeploy-Hook startet.
- **Number ranges**: auto-incremented per company via `next_offer_number()` and `next_project_number()` RPCs.
- **PDF rendering**: `renderDocumentPdf` / `renderOfferPdf` in `services_pdf_render.js` → Nunjucks → Playwright → Buffer. The view model is built first, then passed to the template.
- **Belegvorlagen aus Bausteinen** (Vorlagen-Plan 10/2026, Stufe 1): Rechnung (alle Arten), Storno, Mahnung, Angebot, Auftragsbestätigung und Nachtrag erfassen ihren Hauptteil als `{% set blk_<schlüssel> %}`-Bausteine und geben ihn über `L.body(layout, …)` aus (`templates/modern_a/_layout.njk`); Anhänge über `L.appendices`. Welche Bausteine es je **Kategorie** gibt, was gesperrt ist (Titel, Beträge, Leistungen — Pflichtangaben) und die Standardreihenfolge steht **nur** in `services/documentLayout.js`; Abweichungen (Reihenfolge, Ausblenden, Seitenumbruch, Zahlungshinweis `auto|always|never`, eigene Textblöcke `text:<id>`) kommen aus `theme.bodyByCategory` und später Projekt/Beleg — immer durch `sanitizeLayoutOverride`. Teilschluss erbt von Schluss, Korrektur und Storno von Rechnung (`categoryChain`). Den Render-Kontext baut **nur** `documentContext` (Renderer, Vorschau, Tests). Die Vorschau in den Einstellungen rendert die echten Vorlagen mit `services/documentSamples.js` — wer einer Vorlage ein Feld gibt, ergänzt es dort. `tests/documentTemplates.snapshot.test.js` hält die Ausgabe je Kategorie fest: ein Umbau ohne sichtbare Änderung muss ihn grün lassen, eine gewollte Änderung aktualisiert ihn bewusst (`-u`).
- **Einstellungen → Dokumentvorlagen** (Vorlagen-Plan Stufe 2, `pages/admin/DokumentvorlagenPage.tsx`, `?tab=dokumentvorlagen&sub=gestaltung|aufbau|texte[&cat=…][&type=…]`): Gestaltung und Aufbau sind **ein** Entwurf mit einem Speichern (`PUT /document-templates/branding`), Texte haben ein eigenes (alle geänderten Belegarten auf einmal). Welche Belegarten, Bausteine, Platzhalter und Textvorlagen es gibt, liefert **nur** `GET /document-templates/catalog` (`documentLayout.documentCatalog`, offen für alle Angemeldeten) — das Frontend führt keine eigenen Listen, und `tests/fixtures/dokumentvorlagenData.ts` nimmt dieselbe Funktion als Mock. Je Ebene wird nur die **Abweichung** gespeichert (`toOverride(state, base)` in `components/vorlagen/layoutModel.ts`): wer die Rechnung anpasst, ändert die Korrektur mit, solange sie keine eigene Einstellung hat — gleich dem Stand darunter heißt „keine Zeile". Eine Kategorie mit eigenem Zahlungs-Standard (Korrektur: nie, Mahnung: immer) erbt den Zahlungshinweis **nicht** (`documentContext` und `templateLevels`) — sonst stünde „Bitte überweisen Sie −1.190 €" wieder auf jeder Korrektur. Platzhalter stehen einmal in `services/documentPlaceholders.js` (`scope` = wo sie einen Wert haben; bekannte ohne Wert werden leer, unbekannte bleiben sichtbar stehen) und wirken in Kopf-/Fußtexten, eigenen Textblöcken und Mahntexten. **Textbausteine** (`DOCUMENT_TEXT_SNIPPET`, Migration `0184`, `services/documentTexts.js`, `/document-texts`): lesen alle, ändern mit `settings.text_templates.edit`; übernommen wird der Text, kein Verweis. Standardtexte nur für `TEXT_TYPES` aus der Registry (`saveTextTemplate` lehnt andere ab); Teilschluss fällt auf Schluss zurück (`textTypeChain`). Den Aufbau-Editor (`LayoutEditor`, `AppendixEditor`, `DocPreview`, `PlaceholderChips`) nutzt Stufe 3 im Rechnungsassistenten wieder.
- **Aufbau je Projekt und je Beleg** (Vorlagen-Plan Stufe 3, Migration `0185`, `services/documentLayoutStore.js`, `controllers/documentLayouts.js`): Ebenen Firmenvorlage → `PROJECT.DOCUMENT_LAYOUT_JSON` (`{ kategorie: Abweichung }`) → `INVOICE`/`ADVANCE_INVOICE.DOCUMENT_LAYOUT_JSON`, zusammengesetzt **nur** über `documentLayout.layoutLevels` (Server) bzw. `templateLevels`/`useBelegAufbau` (Frontend). Endpunkte an `/invoices/:id` und `/partial-payments/:id`: `GET layout` (invoices.view), `PUT layout` (Entwurfsrecht; `project` zusätzlich `projects.edit`, sonst 403; gebucht 409), `POST pdf/preview` (HTML mit ungespeichertem Stand, `invoices.download_pdf`, zählt im Limiter als teuer). Im Assistenten („Prüfen & buchen", `components/vorlagen/BelegAufbau.tsx`) wird **mit dem Schritt** gespeichert — `aufbau.save()` in Entwurf speichern, vor dem Buchen und vor PDF/XML —, nie beim Tippen. Beim Buchen friert `freezeLayoutSnapshot` den Projekt-Aufbau ein (`DOCUMENT_LAYOUT_SNAPSHOT_JSON`, best-effort nach dem Status-Update); ein gebuchter Beleg rendert mit Theme- und Layout-Snapshot (`buildDocumentHtml`). **Versand und Hybrid-PDF nehmen bei gebuchten Belegen das archivierte PDF** (`documentPdfBuffer`) — vorher renderten beide neu, mit der heutigen Vorlage. Eigene Textblöcke gehen als Hinweise (BT-22) in CII und UBL (`layoutTextNotes`, `data.layoutNotes`). Neu ausstellen nimmt `DOCUMENT_LAYOUT_JSON` mit, ein Storno nicht.
- **Seitenaufbau der Briefe** (Vorlagen-Plan Stufe 4): `theme.layout` = Stil (`standard|klar|kompakt|architektur`), Anschriftfeld (`none|B|A`, DIN 5008), `foldMarks`, `followHeader`; `theme.letterhead` = Briefpapier-PDF (`assetId` eines `LETTERHEAD`-Assets, Upload-Recht `settings.document_templates.edit`, `pages`, `hideFooter`). **Standard + `none` erzeugt kein zusätzliches CSS** — bestehende Belege sehen aus wie bisher (D6), die Snapshot-Tests halten das fest. Stile und DIN sind CSS über die gemeinsamen Klassen aller Briefvorlagen (`services_theme_styles.js`, angehängt in `buildThemeHead`); die DIN-Maße sind vom Blattrand auf den Satzspiegel umgerechnet (`renderPdf`: 14 mm oben, 25 mm links) — wer die Ränder ändert, ändert dort mit. Briefpapier, Falzmarken und Folgeseitenkopf gehen nicht im HTML (Rand wird nicht bedruckt, Chromiums Kopfzeile kennt keine Folgeseiten) und laufen als Nachbearbeitung mit pdf-lib (`services/pdfFinish.js`): Briefpapier als **erster** Inhaltsstrom unter den Inhalt, nur aus einem eigenen PDF-Asset, ein defektes Briefpapier verhindert keinen Beleg. Alle Briefe (Rechnungen, Angebot, AB, Nachtrag, Mahnung, Vorschau) gehen über `renderLetterPdf`; interne Berichte (Honorar, WIP, Monatsabschluss) weiter über `renderPdf`. Die neuen Stile haben eine lesbare Fußzeile (7 pt statt 7 px). In den Einstellungen zeigt „Als PDF ansehen" (`POST /document-templates/preview/pdf`) alles, was die HTML-Vorschau nicht kann.
- **Vorlagen-Varianten** (Vorlagen-Plan Stufe 5, D3, `services/documentTemplates.js` → `*Variant`): benannte Vorlagen neben dem Standard, je **eine** `DOCUMENT_TEMPLATE`-Zeile mit `DOC_TYPE = 'VARIANT'` und vollem Theme — die Belegart-Defaults findet `loadTemplate` so nie versehentlich. Bearbeitet in Einstellungen → Dokumentvorlagen (`?v=<id>`, Leiste über Gestaltung/Aufbau), gewählt je Beleg im Assistenten-Panel (`PUT …/layout` mit `templateId` → `DOCUMENT_TEMPLATE_ID`, nur aktive Varianten des eigenen Mandanten). Entfernen archiviert nur; Standardtexte und Textbausteine gelten für alle Varianten. `loadTemplate` lädt eine Vorlage per ID **nur aus dem eigenen Mandanten** (die ID kam teils aus `?template_id=` und wurde ungeprüft geladen). In der Vorschau heißt `templateId: null` ausdrücklich Standard (`templateChoice`), ohne Angabe gilt die des Belegs. Neu ausstellen nimmt `DOCUMENT_TEMPLATE_ID` mit.
- **Verzugszinsen und -pauschale** (Migration `0186`, `services/verzugszinsen.js`): je Mahnstufe einschaltbar (`MAHNUNG_SETTINGS.CHARGE_INTEREST/CHARGE_FLAT_FEE`), Basiszinssatz mit Stichtag als Einstellung (`dunning_base_rate_percent/_since`, gepflegt über `PUT /mahnungen/settings` mit `baseRate`, Recht `settings.dunning_config.edit`). Verbraucher (`ADDRESS.IS_CONSUMER`, „Privatperson" im Adressformular): 5 statt 9 Prozentpunkte, keine 40 €. **Ohne hinterlegten Basiszinssatz keine Zinsen** — lieber keine als falsche; ein Satz für den ganzen Zeitraum, Rechenweg steht auf der Mahnung. Mahnstufen-Bezeichnungen nur aus `services/mahnstufen.js`.
- **PDF/A-3b** für das ZUGFeRD-Hybrid-PDF (`services_einvoice_pdf_embed.js`): OutputIntent mit dem sRGB-Profil des ICC (`backend/assets/icc/sRGB2014.icc` — unverändert lassen, `*.icc binary` in `.gitattributes`), XMP mit `pdfaid` 3B und Erweiterungsschema für `fx`, Info/XMP aus **einem** Zeitpunkt, `/ID` im Trailer. **Nachgewiesen mit veraPDF im CI-Job `pdfa`** (`scripts/pdfa-check.sh`, Musterbelege aus `backend/scripts/pdfa-sample.js`, Standard und alle Gestaltungsoptionen). Was ins Chromium-PDF kommt, muss selbst PDF/A-tauglich sein: keine pdf-lib-Standardschriften (nicht eingebettet — deshalb rendert der Folgeseitenkopf als eigene Chromium-Seite), Briefpapier mit eingebetteten Schriften und RGB. Details: `docs/PDFA3_MACHBARKEIT.md`.
- **Umbuchen von Buchungen** (`rebookBuchungen` in `services/buchungen.js`,
  `POST /buchungen/umbuchen[/vorschau]`, Recht `projects.bookings.rebook` aus
  Migration `0139`): verschiebt Buchungen auf ein anderes Projektelement, auch
  über Projektgrenzen. Zwei Regeln sind bindend: eine Buchung mit `INVOICE_ID`
  oder `ADVANCE_INVOICE_ID` ist **gesperrt** (ein gestellter Beleg darf seine
  Grundlage nicht verlieren — Korrektur läuft über Storno/Gutschrift), und
  `COSTS`/`REVENUE` werden bei **Quelle und Ziel** neu gerechnet, auch wenn ein
  Schreibvorgang mitten in der Auswahl abbricht. Der Stundensatz kommt nach dem
  Umbuchen aus der `EMPLOYEE2PROJECT`-Zuordnung des Ziels (fehlt sie, bleibt der
  alte Satz und die Antwort sagt das); der Kostensatz bleibt, er hängt am
  Mitarbeiter. Die Vorschau ist derselbe Lauf mit `dryRun` — keine zweite Kopie
  der Prüfungen. Jede Umbuchung landet in `TEC_REBOOKING`.
- **Monatsrunde Leistungsstände** (Projekte → Reiter „Leistungsstände",
  `GET /projekte/leistungsstand/runde`, `services/leistungsstandRunde.js`):
  Arbeitsliste der laufenden Projekte (Status aus Monatsabschluss), vorbelegt
  „meine" und letztes Monatsende. Erledigt ist ein Projekt, sobald
  `PROJECT.PROGRESS_REVIEWED_AS_OF ≥ Stichtag` — gesetzt von Speichern und
  „Unverändert bestätigen" (`POST /projekte/:id/leistungsstand` mit
  `as_of_date` / `confirm_unchanged`). Rechte: `projects.performance.view/edit`,
  kein eigenes. „Jetzt wichtig" zeigt „Leistungsstände {Monat}: n von m offen"
  (Alert-Typ `progress_round`).
- **Teilfertige Leistungen** (`services/wipReport.js`, Report unter Projektdaten):
  der kaufmännische Abschluss. Je Projekt und Stichtag `unfertig = max(0,
  Leistungswert − abgerechnet)`, HGB-Ansatz `min(Kostenanteil, unfertig)`.
  Zwei Regeln sind bindend und nicht „Aufräumsache": Aktivposten und erhaltene
  Anzahlungen werden **projektweise getrennt** geführt und nie saldiert (§ 246
  Abs. 2 HGB), und der HGB-Wert enthält **keinen** anteiligen Gewinn (§ 252
  Abs. 1 Nr. 4 HGB). Stichtagswerte in der Vergangenheit hängen an den
  `PROJECT_PROGRESS`-Snapshots — fehlt einer, weist der Report das aus statt
  eine 0 zu zeigen. Maßgeblich ist der **Stichtag des Standes**
  (`PROJECT_PROGRESS.AS_OF_DATE`, Migration `0170`), nicht `created_at`: je
  Element steigt er nie ab — Fortschreibungen übernehmen ihn, ein Element mit
  späterem Stand ist für einen früheren Stichtag gesperrt
  (`services/leistungsstandRunde.js`). Wer neu in `PROJECT_PROGRESS` schreibt,
  hält diese Regel ein: „heute" (Spaltenstandard) oder das Datum der Vorlage. Optional daneben: ein zweiter Wertansatz für die
  Steuerbilanz und eine Gegenprobe des Leistungsstands über eine
  Zielkostenquote — beide bleiben ohne gepflegte Einstellung ganz aus, statt
  eine 0 zu behaupten. Konzept: `docs/TEILFERTIGE_LEISTUNGEN_CONCEPT.md`.

---

## E-Rechnung — das Mapping liegt im Code, nicht in einer Tabelle

Bis 09/2026 stand das Feld-Mapping (welche DB-Spalte wird welches EN-16931-Feld)
in `backend/config/Mapping BT.xlsx`. Die Datei ist weg, und zwar aus drei
Gründen, von denen jeder für sich reicht: sie **konnte nichts beweisen** (ob ein
Feld wirklich im XML landet, wusste sie nicht — BT-11 war monatelang geladen und
wurde nie ausgegeben), sie war **im Review unlesbar** (`git diff` zeigt bei einer
.xlsx „binary files differ"), und sie war **bereits falsch** (BT-13 und BT-14
zeigten beide auf `CONTRACT.ABBR`). Ihr Lader `services_bt_mapping.js` hatte
obendrein keinen einzigen Aufrufer.

**An ihre Stelle tritt `backend/einvoice/`:**

| Datei | Beantwortet |
|---|---|
| `btRegistry.js` | Welches Feld geht in welches XML-Element? (**Quelle der Wahrheit**) |
| `codelists.js` | Welche Werte darf ein Feld tragen? (UNTDID 1001/5305/4461/4451, UN/ECE Rec. 20) |
| `profiles.js` | Welche Ausbaustufe erzeugen wir? (Factur-X MINIMUM…EXTENDED, XRechnung, Peppol) |
| `referenceDocument.js` | An welchem Beleg wird geprüft? (zwei Musterbelege: Regelsatz und §13b) |
| `registryCheck.js` | Stimmt die Tabelle noch? (`npm run einvoice:check`) |
| `generateMappingDoc.js` | Erzeugt `docs/EINVOICE_BT_MAPPING.md` (`npm run einvoice:gen`) |

**Warum das nicht wieder driften kann**: `registryCheck` rendert aus den
Musterbelegen echtes CII- und UBL-XML und hält die Registry dagegen — **in beide
Richtungen**. Eine Zeile, deren Pfad im Dokument fehlt, ist ein Fehler; ein
Element im Dokument, das keine Zeile hat, ebenso. Die zweite Richtung ist die,
die eine gepflegte Tabelle nie hat: sie fängt das neu ergänzte Feld, an das
niemand mehr gedacht hat. Dazu kommt: jede BT-Nummer im Quelltext und jedes
`btField` einer Validator-Regel muss es in der Registry geben. Läuft als
`tests/einvoice_mapping.test.js` bei jedem Push — dieselbe Bauart wie der
Lizenz-Drift-Check.

**Beim Ergänzen eines Feldes** (Reihenfolge ist bindend):
1. Zeile in `btRegistry.js` auf `emitted` und beide XML-Pfade eintragen
2. Builder ergänzen (`services_einvoice_cii.js` / `_ubl.js`)
3. `referenceDocument.js` so füllen, dass das Feld wirklich anfällt — sonst
   meldet der Check die Zeile als unbelegt
4. `npm run einvoice:gen` und **die erzeugte `docs/EINVOICE_BT_MAPPING.md`
   mitcommitten** (gleiche Regel wie bei `license:gen`)

**Codes nie als Literal schreiben.** Belegart, Steuerkategorie, Zahlungsart und
Mengeneinheit kommen aus `codelists.js`. Ein falscher Code ist beim Empfänger
eine harte Abweisung, sieht im Quelltext aber aus wie jeder andere String. Die
Belegart bildet `documentTypeCode()` — die fachliche Fallunterscheidung steht
einmal da, der Unterschied zwischen den Syntaxen (CII 875/876/877, UBL 326/380)
daneben. Vorher waren das zwei Ternär-Kaskaden nebeneinander.

**Die XML-Erzeugung bleibt handgeschrieben.** Die beiden Builder sind auditiert
und gegen Norm-Eigenheiten gehärtet, die ein generischer Serializer schlechter
ausdrückt: Elementreihenfolge nach D16B-Sequenz, negative Menge statt negativem
Einzelpreis beim Storno (BR-27), bedingt ausgelassene Gruppen. Getauscht wurde
das, was risikobehaftet war — die unbeweisbare Tabelle daneben, nicht der
geprüfte Code.

Vollständige Feldtabelle samt Abdeckung: `docs/EINVOICE_BT_MAPPING.md`.
Befundlage: `docs/AUDIT_2026-08-25_HOAI_UND_ERECHNUNG.md`.

---

## Deployment

**Gehostet wird auf Scalingo** (`planandsimple`), nicht mehr auf Railway. Railway war
bis zum Umzug die produktive Instanz; Erwähnungen davon in älteren Dokumenten
beziehen sich auf diesen früheren Stand.

1. Push to `main` → Scalingo baut über das Node-Buildpack (`scalingo-postbuild` in der
   Root-`package.json`), Start über `Procfile` → `bin/start-web.sh`
2. **SQL-Migrationen laufen im `postdeploy`-Hook mit** (seit 09/2026, `Procfile` →
   `node backend/scripts/migrate.js --auto`). Der Hook läuft synchron am Ende jedes
   Deploys in einem One-off-Container; **schlägt er fehl, schlägt der Deploy fehl**
   (Status `hook-error`) und die alte Version bleibt online. Neue Migration also nur
   nach `backend/migrations/` legen und pushen — nichts von Hand einspielen.

   Drei Regeln dazu, jede aus einem konkreten Schaden entstanden:
   - **`APPLIED_BASELINE.txt` ist die Grenze.** Bis 09/2026 lief jede Migration von
     Hand, `_migrations` ist produktiv deshalb leer, obwohl die Datenbank auf dem
     Stand aller Dateien ist. Was in der Baseline steht, wird **vermerkt und nie
     ausgeführt** — sonst liefen 151 Dateien erneut, inklusive Daten-Migrationen und
     Seeds ohne `ON CONFLICT`. **Neue Dateien gehören NICHT hinein**, sonst laufen
     sie nie.
   - **Generierte Seeds tragen `-- @repeatable`** und werden über ihren Inhalts-Hash
     eingespielt, nicht über den Dateinamen (siehe unten, `0070b`). Sie müssen
     deshalb wiederholbar geschrieben sein: `INSERT … ON CONFLICT DO NOTHING`,
     kein `DELETE`, kein `TRUNCATE`.
   - **Der RLS-Claim bleibt Sache der Migration.** Der Runner verbindet sich mit
     `pg` und trägt kein JWT — eine Migration, die mandantenbezogene Tabellen liest
     oder schreibt, muss `SET request.jwt.claims` selbst setzen (siehe Database
     conventions). Daran ist `0136` gescheitert, nicht am Einspielweg.

   **PostgREST kennt eine neue Spalte nicht von selbst.** Es liest das Schema
   einmal beim Start — und der Web-Container startet **vor** dem
   postdeploy-Hook. Eine Spalte, die derselbe Deploy anlegt *und* benutzt, ist
   danach in der Datenbank, aber nicht im Cache; PostgREST antwortet mit
   `Could not find the 'X' column of 'Y' in the schema cache`, also mit einem
   Fehler, der wie ein vergessenes Feld aussieht und nicht wie ein Cache. Genau
   daran scheiterte der Mitarbeiter-Import nach Migration `0165`. Tückisch
   war die Zufälligkeit: beim nächsten Container-Neustart löste es sich von
   selbst, wer einen Tag später importierte, sah nichts.

   Der Runner schickt deshalb am Ende jedes Laufs `NOTIFY pgrst, 'reload
   schema'` — PostgREST lauscht auf diesem Kanal, ein Neustart ist nicht nötig,
   und es funktioniert aus dem One-off-Container heraus, weil die Nachricht über
   die Datenbank läuft. Schlägt es fehl, gibt es eine Warnung, aber keinen
   Deploy-Abbruch: die Migration ist zu dem Zeitpunkt bereits eingespielt.
   Von Hand geht dasselbe:
   `scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -c "NOTIFY pgrst, '"'"'reload schema'"'"'"'`

   Notbremse: `MIGRATE_ON_DEPLOY=false` → der Hook berichtet nur und ändert nichts.
   Von Hand geht weiterhin:
   `scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0139_….sql'`
   Dateien liegen in `backend/migrations/`, nummeriert `0001_…`; Status ansehen mit
   `node backend/scripts/migrate.js --status`.
3. Umgebungsvariablen über `scalingo --app planandsimple env-set …` bzw. das Dashboard:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `SMTP_*`, `FRONTEND_URL`,
   `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. **Ohne die VAPID-Schlüssel
   gibt es keinen Geräte-Push** — die Benachrichtigung landet nur in der App, und zwar
   ohne Fehlermeldung. Seit 09/2026 sagt das Startprotokoll, woran man ist
   (`🔔 Web-Push aktiv` / `🔕 Web-Push INAKTIV`); erzeugt werden sie mit
   `npx web-push generate-vapid-keys`. Ein Tausch entwertet alle bestehenden
   Geräte-Freigaben.
4. Runbook: `docs/SCALINGO_DEPLOY_RUNBOOK.md`

**`DISABLE_BACKGROUND_JOBS` gehört NICHT auf die produktive Instanz.** Das Flag
verhindert, dass die Hintergrund-Checker starten — ohne sie entsteht keine einzige
geplante Benachrichtigung (weder Push noch in-app). Es war ausschließlich für den
Parallelbetrieb gedacht, als Scalingo und Railway gleichzeitig auf dieselbe Supabase
zeigten. Läuft nur noch eine Instanz, muss es weg. Prüfbar in der Oberfläche unter
Einstellungen → Benachrichtigungen → „Zustellung prüfen".

---

## Owner-Konsole — läuft auf dem Arbeitsplatz, liest die Scalingo-Datenbank

`owner-console/` ist eine eigenständige App (eigene Auth, eigenes Secret, TOTP)
und wird **nicht deployt**. Sie startet mit `npm start` bzw. `start-konsole.cmd`
— und das startet drei Dinge: `scalingo db-tunnel`, ein **lokales PostgREST**
davor und dann erst `server.js` (`owner-console/scripts/start.js`). Nötig ist
der Umweg, weil PostgREST im Scalingo-Container nur auf `127.0.0.1` lauscht.
Die Konsole trägt dabei den `sys`-Claim — sie ist neben Signup und den
Hintergrund-Checkern der dritte Träger.

**`node server.js` allein geht nicht mehr, und das ist Absicht.** Bis 09/2026
hatte die Konsole einen eigenen Supabase-Client und ist beim Umzug nicht
mitgegangen: sie las danach monatelang die abgehängte Supabase und zeigte deren
Datenstand an, ohne das irgendwo zu sagen. Aufgefallen ist es erst, als die
Lizenz-Inbox den heutigen Code gegen ein Schema von vor den Umbenennungen hielt
(`TEC` statt `BOOKING`, 112 statt 114 Permissions) und 37 Befunde meldete, von
denen 12 reine Artefakte waren. Ohne `POSTGREST_URL` bricht sie deshalb ab,
statt zurückzufallen; **welche Datenbank dahintersteckt, steht im
Startprotokoll, unter `/health` und in der Kopfzeile der Oberfläche.**

Die Anwendung selbst kennt denselben Rückfall (`backend/db.js` ohne
`POSTGREST_URL` → alter Supabase-Client). Sie protokolliert ihn beim Start
(`🗄 Datenbankweg: …`), bricht aber nicht ab — auf Scalingo stehen
`SUPABASE_URL`/`SUPABASE_SERVICE_KEY` weiterhin in der Umgebung.

Einrichtung, Stellschrauben und Fallstricke (SSH-Schlüssel, `libpq` unter
Windows): `owner-console/README.md`.

---

## Security model — Stand und offene Punkte

> Maßgeblich sind `docs/SECURITY_AUDIT_CONCEPT.md` (Prüfbereiche, Schweregrade,
> Befundformat) und `docs/SECURITY_AUDIT_2026-09-03.md` (Befunde und ihr Stand).
> Dieser Abschnitt ist die Kurzfassung — **beim Beheben eines Befundes hier
> mitziehen.** Eine Liste, die Behobenes als offen führt, lenkt von den echten
> Lücken ab und zählt im Audit selbst als Befund (N1).

**Vorhanden:**
- bcrypt-Passworthashes (Altkonten mit Klartext sind weiterhin möglich — Rückfall in `routes/auth.js`)
- JWT auf allen Routen außer `/auth`, `/webhooks`, `/track`, `/branding`; Reset-Token werden als Sitzung abgelehnt (`middleware/auth.js` → `verifySessionToken`)
- **Mandantentrennung zweilinig**: Anwendungsfilter *und* RLS in der Datenbank (`FORCE ROW LEVEL SECURITY`, fail-closed ohne Claim — `db.js`, `backend/scripts/migration/05_rls_scalingo.sql`)
  Vier Kindtabellen tragen den Mandanten nur ueber einen Fremdschluessel und
  waren deshalb nicht erfasst — `ROLE_PERMISSION`, `EMPLOYEE_ROLE`,
  `BUDGET_WARNING_FIRED`, `SERVICE_REQUEST_MESSAGE`. Seit Migration `0160`
  haengen sie ueber eine Policy am Elternsatz drin (Muster wie `ASSET`). Alle
  uebrigen Tabellen ohne `TENANT_ID` sind geteilte Kataloge — dort gibt es
  nichts zu trennen. **Eine neue Tabelle erbt die zweite Linie nicht**: die
  Schleife in `05_rls_scalingo.sql` war ein Einmal-Lauf, jede neue Migration
  setzt RLS selbst (Vorbild: `0137`, `0139`).
- Startabbruch bei fehlendem/unsicherem `JWT_SECRET`, fehlender Dateiablage oder fehlendem Datenbankweg (`server.js`)
- CORS-Allowlist (`CORS_ORIGINS`/`FRONTEND_URL`), nur auf `/api`; helmet; `trust proxy`
- Rate-Limiter auf allen fünf Auth-Wegen; Reset-Links sind One-Time (Passwort-Fingerabdruck)
- Upload: MIME-Allowlist + 10 MB; Auslieferung über `services/fileResponse.js` (Inline-Allowlist, `nosniff`, Sandbox-CSP)
- Sucheingaben in PostgREST-Filtern über `services/pgrestFilter.js` neutralisiert
- Owner-Konsole: eigenes Secret, eigene Audience, 2 h TTL, TOTP, Audit-Log, `SESSION_EPOCH`
- Automatischer Scan: `node scripts/security-scan.mjs` (CI-Job `security`, täglich mit `--deps`)

- Sitzungs-Rücknahme über `EMPLOYEE.SESSION_EPOCH` (`middleware/sessionGuard.js`): Passwortwechsel, Reset und Rollenänderung beenden laufende Sitzungen sofort. **Der Guard hängt in der authChain hinter `tenantScope`** — davor liegt kein Mandanten-Claim an, und die EMPLOYEE-Abfrage würde unter RLS null Zeilen liefern, also jeden aussperren.
- Upload-Rechte nach `asset_type` (`routes/assets.js`): `AVATAR` ist Selbstbedienung, alles andere verlangt ein bestehendes Recht; unbekannte Arten fail-closed.
- Buchungen: eine abgerechnete Buchung (`INVOICE_ID`/`ADVANCE_INVOICE_ID`) ist auch für `PATCH` gesperrt, und der Monatsabschluss gilt beim Ändern für den alten und den neuen Monat (`patchBuchung`). Timer-Entwürfe liest und bestätigt man nur für sich selbst; fremde nur mit `employees.bookings.view_all` (`controllers/buchungen.js`). Beides war bis Runde 2 des UI-Pilots offen.
- „Eigene Zeit buchen" (`projects.bookings.own`, Migration `0169`): bucht nur für sich selbst (Mitarbeiter aus der Sitzung, Sätze vom Server), ändert/löscht nur eigene, offene Buchungen ohne Projektwechsel, und sieht Projekte/Leistungen nur über die Listen ohne Beträge (`/buchungen/eigen/*`, `services/eigeneZeit.js`). „Meine Zeit" (`GET /buchungen/mine`) braucht kein Recht, weil der Mitarbeiter nie aus der Anfrage kommt. Die Antwort von `PATCH /buchungen/:id` geht durch `stripBookingMoney` wie die Liste — vorher lieferte sie die ganze Zeile samt Sätzen.

- Rechnungsentwürfe (`middleware/draftEdit.js`, UI-Pilot Runde 3): die Speicherschritte der Assistenten (PATCH, Leistungsbetrag, Buchungsauswahl, Positionen/Abzüge, Anlagen) verlangen `invoices.edit` **oder** das Anlege-Recht der Belegart (`invoices.create_partial/_single/_final/_credit`) — Letzteres nur, solange der Beleg ein Entwurf ist (`STATUS_ID = 1`). Die Belegart kommt aus der Datenbank, nie aus der Anfrage; ein fremder oder unbekannter Beleg bekommt dieselbe 403 wie ein fehlendes Recht. Buchen bleibt `invoices.book`, Löschen `invoices.delete`.

- Reporting-Scope (`req.reportScopeProjectIds`, ohne `reports.scope.all` nur geleitete Projekte) gilt auch für den Gesamtverlauf `GET /reports/projects/timeline` — der lieferte bis 09/2026 ohne `project_ids` den ganzen Mandanten und mit `project_ids` beliebige Projekte. Summen eines Gesamtprojekts rechnen nur über Projekte im Scope.
- Drosselung teurer Endpunkte (PDF, Reports) **pro Konto, nicht pro IP** (`middleware/rateLimit.js`) — ein Büro hinter einer NAT-Adresse darf sich nicht selbst aussperren. Die Limiter hängen deshalb hinter `authMiddleware`.
- Progressive Verzögerung bei Fehlversuchen **je Konto** (`middleware/loginAttempts.js`) — bewusst keine Sperre: die wäre ein Weg, einen bekannten Nutzer gezielt auszusperren.
- **Registrierung neuer Mandanten braucht zwei Tore** (`services/signupApproval.js`, Migration 0135): E-Mail-Bestätigung des Anmelders, dann Freigabe in der Owner-Konsole (Tab „Registrierungen"). Bis dahin ist die Anmeldung gesperrt — geprüft **nach** der Passwortprüfung, damit der Zustand eines Mandanten nichts über ihn verrät. Ablehnen löscht den Antrag, aber **nur** im Zustand pending. Der Spaltenstandard von `SIGNUP_STATE` ist `active`: Import, Demo-Daten und manuelles SQL sollen weiterhin benutzbare Mandanten erzeugen.
- Serverfehler tragen nach außen eine allgemeine Meldung plus Fehlerkennung (`middleware/errorSanitizer.js`); das Original steht im Protokoll. Fachfehler mit `status < 500` bleiben unberührt. Ein 500er, dessen Meldung der Nutzer braucht, kennzeichnet sich mit `userFacing: true`.
- **PDF-Renderer abgeschottet** (Vorlagen-Audit 10/2026, `renderPdf` in `services_pdf_render.js`): je Beleg ein eigener Browser-Kontext **ohne JavaScript**, jede Netzwerkanfrage wird abgebrochen. Vorher ließ ein `url(…)` im CSS oder ein `<img src="http://…">` den Server Anfragen ins interne Netz schicken (PostgREST auf 127.0.0.1:3001) — und `header.logoMaxHeightMm` landete ungeprüft im `<style>`. Gestaltung (`THEME_JSON`) läuft beim Speichern **und** Rendern durch `sanitizeTheme` (`services_theme_schema.js`: nur bekannte Schlüssel, Typen, Wertebereiche); gecachte Logos nur als `data:image/…`, Logos aus Assets über die Objektablage. Was ein Beleg braucht (Logo, Schriften, GiroCode), steckt als data:-URI im HTML. Tests: `pdfRenderSandbox.test.js` (echter HTTP-Server, darf keinen Treffer sehen), `themeSchema.test.js`. Mailtexte gehen nur über `plainTextHtml` (`services/emailService.js`) in die HTML-Fassung. Eine Vorlage per ID (`?template_id=`, Variante am Beleg) lädt `loadTemplate` nur aus dem eigenen Mandanten; Briefpapier nur aus einem eigenen PDF-Asset (`services/pdfFinish.js`).

- **Mitarbeiter-Modul (UI-Pilot Runde 10, `tests/mitarbeiter.security.test.js`):**
  - Rechte laden ist **fail-closed**: ein Ladefehler ist eine 503, nicht „alle Rechte". Nur eine fehlende RBAC-Migration bleibt unrestricted (`middleware/permissions.js`, `LOAD_FAILED`).
  - Der Gehalts-Guard vergleicht den Pfad wie Express 5 (klein, ohne abschließenden Schrägstrich) und hängt zusätzlich an den Routen — `/5/cp-rates/` lief vorher vorbei.
  - Die E-Mail eines **fremden** Kontos ändert nur, wer `employees.password.set` hat (sonst Übernahme über „Passwort vergessen"); danach enden dessen Sitzungen. `PATCH /mitarbeiter/:id` ist ein Teil-Update.
  - „Nicht mehr vergeben, als man selbst hat" (`keysBeyondCaller`): Passwort setzen und Rollen zuweisen nur für Konten und Rollen, deren Rechte der Aufrufer selbst hat. Passwort setzen beendet Sitzungen. Der Import prüft dieselben Rechte je Inhalt (Kostensatz, Rolle, E-Mail beim Zusammenführen) und die Platzgrenze (`authorizeEmployeeCommit`).
  - Das eigene Konto und der letzte Administrator lassen sich weder löschen noch deaktivieren; inaktive Admins zählen nicht. Die Löschprüfung kennt Angebote, Rechnungen, Abschläge, Mahnungen, Nachträge und Abwesenheiten und schluckt keine Fehler mehr (`safeReferences`).
  - Arbeitszeitmodell zuordnen nur mit einem Modell des eigenen Büros, gültigem Datum und für einen eigenen Mitarbeiter; Neuanlage prüft den Vorgesetzten wie das Ändern und legt leere Angaben als `null` ab; das eigene Passwort lässt sich nicht löschen (Selbstaussperrung); Urlaubsansprüche je Jahr (`PUT /abwesenheit/entitlements/bulk`) nehmen keine leeren oder ungültigen Tage mehr als 0 und melden Teilfehler statt Erfolg.
  - Profilfoto nur aus einem `AVATAR`-Bild; ArbZG-Audit/Export/Grenzen nur eigene oder mit Recht; Stundensätze der Team-Zuordnung nur mit `projects.hourly_rates.view`; Kosten im Stundencontrolling nur mit `employees.salary.view`; fremde Salden nur mit `employees.bookings.view_all`; Kostensatzrechner-Gehaltsdaten nur mit den Gehaltsrechten.

- **Aus dem Mitarbeiter-Audit, Runde 11 geschlossen:**
  - Urlaubstage zählen nach dem am Tag gültigen Arbeitszeitmodell (Tage ohne Soll sind frei) und je Kalenderjahr getrennt (`workdaysByYear`, `takenVacationByYear` in `routes/abwesenheit.js`); ohne Modell weiter Mo–Fr.
  - Kostensatz-Übernahme (`importCostRates`, `services/costRateCalc.js`): je Mitarbeiter und Tag ein Satz; „Buchungen neu rechnen" nur für Stundenbuchungen bis zum nächsten Satz, nie in abgeschlossenen Monaten, Projektkosten werden nachgerechnet; bewusst `update` statt `upsert` (der INSERT-Teil scheitert an Pflichtspalten).
  - Import-Rücknahme prüft alle Blocker **vor** der ersten Änderung, schluckt keine Fehler und steht nach einem Abbruch auf `rollback_partial` — ein erneuter Versuch setzt fort (`rollback`, `services/importService.js`).
  - Der Einladungslink verlässt den Server nicht mehr: ohne Mailversand kam er in der Antwort der Neuanlage und von „Einladung senden" zurück.
  - Eine eigene genehmigte Abwesenheit storniert man selbst nur, solange sie nicht begonnen hat (`POST /abwesenheit/:id/cancel`, sonst 409; mit `absence.manage` immer). Vorher ließ sich genommener Urlaub hinterher stornieren — die Tage kamen auf den Resturlaub zurück. Abgelehnte und stornierte Einträge lassen sich nicht erneut stornieren.
- **Einstellungen (UI-Pilot Runde 12):** `PUT /stammdaten/defaults` nahm jeden Schlüssel ungeprüft an — wer Vorbelegungen pflegen durfte, überschrieb damit Firmenlogo (`co_<id>_logo_data_uri`), Monatsabschluss, Arbeitszeitregeln und Urlaubsverfall. Jetzt feste Liste mit Recht je Schlüssel (`settings.defaults.edit` bzw. `settings.company.edit` fürs Branding), Wertprüfung, Firma/Anmeldebild nur aus dem eigenen Büro (`services/tenantDefaults.js`). `GET /defaults` lieferte allen Angemeldeten sämtliche Einstellungen samt gespeichertem Monatsabschluss-Bericht — jetzt nur die Liste. `POST /stammdaten/status` ist entfernt: es schrieb in den **globalen** Katalog `PROJECT_STATUS`, ein Büro legte so einen Status für alle an. Arbeitszeitmodelle nahmen jedes Soll an (−8 h, 30 h), jedes Land und eine Pausenregel eines fremden Büros — jetzt 0–24 h je Tag, Land/Bundesland aus der festen Liste, Pausenregel nur aus dem eigenen Büro, fremde oder unbekannte Modelle 404 statt 500 (`services/workingTimeModels.js`).

**Offen (Stand 2026-09-29):**
- Klartext-Passwörter aus der Frühphase weiterhin login-fähig (M7) — vor dem Entfernen des Zweigs muss die Anzahl betroffener Konten bekannt sein, Befehl im Bericht
- CSP bewusst abgeschaltet (SPA-Bundles, PDF) — erhöht die Wirkung jeder Datei-Auslieferungslücke (N2)

---

## Icon system (Lucide React)

`lucide-react` is the only icon library used in this project. **Never use emoji or Unicode characters as UI icons** — they render inconsistently across platforms and break the visual language.

**Import pattern:**
```tsx
import { Pencil, FileText, MoreHorizontal } from 'lucide-react'
// <Pencil size={14} strokeWidth={2} />
```

**Standard sizes and contexts:**
| Context | `size` | `strokeWidth` |
|---|---|---|
| Side nav / bottom nav | 18–20 | 1.75 |
| Row action buttons (`.row-action-btn`) | 14 | 1.75–2 |
| Overflow menu trigger (⋯) | 15 | 1.75 |
| Row menu items (inline with text) | 13 | 1.75 |
| Column chooser / small toolbar buttons | 13 | 2 |
| Delete/close/remove buttons | 12 | 2.5 |

**Canonical nav icon mapping (must match BottomNav.tsx and SideNav.tsx):**
- Übersicht → `LayoutDashboard`
- Adressen → `BookUser`
- Projekte → `FolderOpen`
- Reporting → `BarChart3`
- Rechnungen → `Receipt`
- Angebote → `FileSignature`
- Mitarbeiter → `Users`
- Einstellungen → `Settings`

**Common action icons:**
- Edit/open → `Pencil`
- PDF → `FileText`
- Email → `Mail`
- Payment → `Banknote`
- Overflow menu → `MoreHorizontal`
- Close/remove → `X`
- Column chooser → `SlidersHorizontal`
- Invoice link → `Receipt`
- Project link → `Folder`

**CSS:** `.row-action-btn` already uses `display: inline-flex; align-items: center; justify-content: center;` — no extra wrapper needed. For buttons with icon + text, add `gap: 4–6px` via inline style.

---

## Design-Tokens — verbindlich bei jedem neuen UI

Alle Tokens stehen in `frontend-react/src/styles/globals.css` (`:root` + je ein Block pro Theme). **Nie feste Farb-/Abstands-/Radius-Werte schreiben** — es gibt 6 Themes, hartkodierte Werte ändern sich beim Theme-Wechsel nicht mit. Vollständige Analyse: `docs/UX_UI_AUDIT_2026-08.md`.

| Zweck | Tokens |
|---|---|
| Text | `--text`, `--text-2`, `--text-3` (alle ≥ 4,5:1) · `--text-4` (nur Platzhalter/UI, 3:1) · `--text-5` (rein dekorativ, **nicht für lesbaren Text**) |
| Flächen | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--dim`, `--dim-2` |
| Akzent | `--accent`, `--accent-dark`, `--accent-bg`, `--accent-tint…3`, `--accent-ring`, `--accent-rgb` |
| Schrift auf Farbflächen | `--btn-fg` (auf `--btn`/`--cta`), `--accent-fg` (auf `--accent`) — **nie `#fff` hartkodieren** |
| Status | `--success`, `--danger`, `--warning`, `--info` + je `-strong` und `-bg` (statt `#dc2626`, `#16a34a`, …) |
| Abstand | `--space-1` (4px) … `--space-8` (32px) |
| Radius | `--radius-sm` (6) · `--radius-md` (10) · `--radius-lg` (14) · `--radius-pill` |
| Schatten | `--shadow-sm/md/lg` (theme-abhängig über `--shadow-color`) |
| Interaktion | `--hover-bg`, `--focus-ring` |

**Regeln**
- Kontrast: neue Farbkombinationen müssen WCAG AA (4,5:1 für Text) in **allen 6 Themes** erfüllen — nicht nur im Default.
- Fokus: `:focus-visible` ist global gesetzt. Bei eigenen Komponenten **nie `outline: none` ohne Ersatz**.
- Buttons sind standardmäßig flach; Erhebung nur bewusst über `.btn-elevated`.
- Dialoge: `Modal`/`ConfirmModal` benutzen (bringen Escape, Fokus-Falle, Fokus-Rückgabe, `role="dialog"` mit). Kein eigenes Overlay bauen.
- Dialog-Fußzeile: **immer `<DialogFooter>`** aus `components/ui/`, nie ein eigenes `flex-end`-`<div>` und nie `.modal-actions` direkt. Reihenfolge ist verbindlich: **Abbrechen links, Hauptaktion rechts** (13 Dialoge hatten es umgekehrt — dieselbe Position, gegenteilige Wirkung). Abbrechen trägt `.btn-secondary`, jeder Knopf ein `type="button"`. Ein Löschen-Knopf gehört in die `secondary`-Zone, nicht gleichrangig neben „Speichern". Geprüft von `tests/dialogs.spec.ts`.
- Modulseiten (Übersicht, Adressen, Projekte, Rechnungen, Angebote, …) zeigen **keinen sichtbaren Seitentitel** — welches Modul offen ist, sagt die Seitennavigation. Die `<h1>` bleibt für Screenreader: `<PageHeader title="…" srTitle />` bzw. `<h1 className="sr-only">`. Eine Hauptaktion ohne Kopf steht rechts neben den Reitern (`.module-tabs-row`). Sichtbar bleiben Titel, die ein **Objekt** benennen (Projektkopf, Adresse, Nachtrag, Assistent).
- Seitenformulare im Arbeitsbereich (Vertrag, Preislisten, Budget): `.ws-form` mit `<FormSection>` aus `components/ui/` — Überschrift als `<h3>`, ab 900px zwei Spalten, `layout="block"` für Tabellen. Eingaben liegen als Änderungen über dem geladenen Stand, gespeichert wird über die ActionBar mit `useRegisterDirty`; keine eigenen Kästen mit `--dim`/Rahmen mehr.
- Navigation: Einträge **nur** in `components/layout/navItems.ts` pflegen — Seiten- und Bottom-Nav speisen sich daraus. `mobileRank` entscheidet, was auf dem Handy in der Leiste landet (max. 5 + „Mehr").
- Regressionstests für diese Punkte: `frontend-react/tests/a11y.spec.ts`.
- Stile für Bausteine (PageHeader, ActionBar, Disclosure …) und die Arbeitsbereiche stehen in `globals.css` im Abschnitt „Arbeitsbereiche und gemeinsame Bausteine“, **gegliedert nach Baustein, nicht nach Runde**. Ein Nachtrag gehört an die bestehende Regel, nicht als zweite Regel ans Dateiende: genau so standen `max-width` des Titel-Knopfs und die Breite des Umschalters zweimal da, und die zweite Regel gewann still.

**Keine hartkodierten Farben — geprüft, nicht erhofft.** `npm run check:design`
lässt jede Hex-Farbe im TSX fehlschlagen. Es gibt genau drei legitime Ausnahmen,
und jede steht mit Begründung in `COLOR_EXEMPT` (`scripts/check-design-system.mjs`):

1. **Canvas** — Chart.js versteht `var(--token)` nicht (`theme/chartTheme.ts`).
2. **Werte, die gespeichert oder ins PDF gerendert werden** — Farbwähler,
   Vorlagen-Akzente. Dort ist eine CSS-Variable schlicht kein Farbwert.
3. **Vorschauen von gedrucktem Papier** — bewusst papierweiß, dürfen im
   Dark-Theme nicht mitkippen.

Alles andere gehört an ein Token. Der UX-Audit 08/2026 zählte 812 Hex-Werte,
im September 2026 waren es 226 — der Rest ist migriert. Im Dark-Theme lag
`#374151` bei 1,65:1, also praktisch unsichtbar; das ist der Grund für die
Regel. Achtung bei Lucide-Icons: `color="var(--x)"` landet als SVG-Attribut
und greift dort **nicht** — `style={{ color: 'var(--x)' }}` nehmen (Lucide
zeichnet mit `currentColor`).

---

## Farben mit Bedeutung — drei getrennte Ebenen

Vollständige Herleitung samt Messwerten: `docs/FARBKONZEPT_2026-09.md`.
Die Kurzfassung, weil sie bei jeder neuen Ansicht gilt:

| Ebene | Wofür | Wechselt mit dem Theme? |
|---|---|---|
| **Marke** | Kopfzeile, Knöpfe, Akzent | **ja** — dafür gibt es die 7 Themes |
| **Bedeutung** | „Soll ich hier hinschauen?" | **nein**, nur hell/dunkel |
| **Daten** | Reihen in Diagrammen unterscheiden | **nein**, nur hell/dunkel |

Bedeutungsfarben sind **Vokabular, nicht Dekoration**: Wer im Tragwerk-Theme
lernt, dass Orange „beobachten" heißt, darf das nicht verlieren, weil der
Kollege daneben ein anderes Theme eingestellt hat. Deshalb werden
`--kpi-*` in keinem Branchen-Theme überschrieben.

**Controlling-Ampel** (`utils/kpiLevel.ts` + `components/ui/KpiValue.tsx`):
`--kpi-plan` · `--kpi-watch` · `--kpi-critical`. Die vierte Stufe
`--kpi-good` existiert als Token, wird aber **nie vergeben** — ein Projekt,
das seine Kosten deckt, ist der Normalfall und keine Auszeichnung. Färbt man
jede gesunde Zeile grün, verliert Rot seine Wirkung. Die Schwellen liegen als
`TENANT_SETTINGS` unter Einstellungen → Vorbelegungen; ungepflegt heißt hier
**bisherige Werte**, nicht „Ampel aus" (anders als beim WIP-Report, wo eine
fehlende Einstellung die Spalte ausblendet, statt eine Zahl zu behaupten).

**Farbe ist nie der einzige Träger** (WCAG 1.4.1): Ampelstufen tragen Symbol
und Klartext, negative Beträge das Minuszeichen.

**Diagrammreihen** stehen in `theme/chartTheme.ts` (Okabe-Ito, ein Satz für
hell und dunkel). Nicht frei Hand erweitern — die Prüfung rechnet den
Farbabstand bei Protanopie und Deuteranopie nach und verlangt ΔE ≥ 15. Der
alte Tailwind-Satz lag bei ΔE 1,1: „Deckungsbeitrag" und „Stunden" waren für
rot-grün-schwache Nutzer identisch.

Welche Kennzahl welche Farbe bekommt, steht **an einer Stelle**: `SERIES_ROLE`
in derselben Datei, abgerufen über `useSeriesColors()` — nie über
`t.series[3]`, der Index sagt nicht, was er bedeutet. Es gibt sechs Farben für
sieben Kennzahlen (Gelb liegt auf Weiß bei 1,1:1, Schwarz ist die
Achsenfarbe — beide fallen als Linie aus), zwei Paare teilen sich also je eine
Farbe. Geteilt wird **nur, was nie im selben Diagramm steht**: Honorar/DB und
Auftragsbestand/Stunden. `chartTheme.test.ts` führt die Diagramme auf und
lässt jede Reihenkollision fehlschlagen.

**Chart.js zeichnet auf `<canvas>` — dort ist `var(--token)` kein Farbwert,
sondern Schwarz.** Der Browser meldet nichts. Genau daran sind Projektverlauf
und Gesamtverlauf gestorben: die Hex-Regel oben hat die Umschreibung sogar
verlangt, `tsc` sah einen `string`, die Kontrastprüfung liest CSS. Deshalb
prüft `npm run check:design` jetzt die Gegenrichtung (jede CSS-Variable an
einer Chart.js-Farboption in einer Diagrammdatei ist ein Befund), und
`tests/charts.spec.ts` zählt am Ende die Farbtöne auf dem fertigen Canvas.
Farben in Diagrammen kommen ausschließlich aus `useChartTheme()` /
`useSeriesColors()` — auch Gitter, Achsen und Tooltip.

---

## Geldbeträge — ein Baustein, eine Konvention

Alles über `frontend-react/src/utils/money.tsx`. **Kein eigener
`Intl.NumberFormat` mit `currency` und kein eigenes `toLocaleString`** —
`npm run check:design` lässt beides fehlschlagen.

| Zweck | Nehmen |
|---|---|
| Betrag in einer Zelle/Kachel | `money(v)` — negative Werte rot |
| Betrag ohne Nachkommastellen | `money0(v)` |
| Zelle mit eigener Grundfarbe (z. B. Akzent) | `moneyOr(v, 'var(--accent)')` |
| Reiner Text (Tooltip, `title`, aria-Label, Chart-Achse) | `fmtEur(v)` / `fmtEur0(v)` |
| Eigene Zelle, nur der Stil | `negativeStyle(v)` / `negativeOr(v, …)` |

**„Rote Zahlen"** ist Konvention, keine Bewertung — sie sagt nichts über
Handlungsbedarf, nur über das Vorzeichen. Deshalb `--kpi-critical` und nicht
`--danger` (das heißt „Fehler / löschen"), und kein Symbol wie bei der Ampel.
Die Grenze ist `< 0`, nicht `<= 0`: Null ist kein Verlust.

`NO_VALUE` („—") heißt **kein Wert**, nicht „0 €". Wo eine 0 fachlich stimmt,
gehört auch eine 0 hin.

Warum das eine eigene Regel ist: Es gab 28 eigene `fmtEur`-Definitionen in 27
Dateien. Genau diese Streuung war der Grund, warum „rote Zahlen" im ganzen
Produkt an **einer** Stelle umgesetzt war — es gab keinen gemeinsamen Ort, an
den man die Regel hätte schreiben können.

---

## UI/UX — responsive & mobile rules

These rules apply to every feature. Playwright smoke tests in `frontend-react/tests/` enforce them automatically in CI.

**Layout**
- No horizontal scroll at any viewport width (test: `document.documentElement.scrollWidth ≤ viewport.width + 2` — **nicht** nur `body`: ein absolut positioniertes Kind am Seitenrand, etwa ein `.sr-only` im Tabellenkopf, verbreitert die Seite, ohne dass `body.scrollWidth` es zeigt. So waren Angebots- und Projektliste am Handy 1111 px breit, samt jedem Dialog darüber. Am Handy ist deshalb `.master-table` selbst der Bezug für solche Kinder.)
- Bottom nav (`.bottom-nav`) must always be visible and reachable — never obscured by modals or sticky headers
- Page content must not be hidden behind the fixed bottom nav — keep `padding-bottom` ≥ 64px on all page roots
- Sticky table headers (`position: sticky`) are **desktop only** — disabled via `@media (max-width: 1023px)` in globals.css to prevent layout issues on small viewports

**Touch targets**
- Minimum 44 × 44 px for every interactive element (buttons, nav items, links, toggles)
- `.bottom-nav-item` items are currently 58px — do not reduce
- Prefer `gap` over reducing hit areas when space is tight

**Navigation (sidebar / bottom nav)**
- Focus-visible styles are defined in globals.css (`:focus-visible` with `outline`) — always test keyboard navigation
- Use `var(--chrome-hover-bg)` for hover state on sidebar items (not a flat `var(--surface-2)` which may not contrast on dark chrome)

**Inputs**
- Always use the correct `type` attribute for mobile keyboards: `type="email"`, `type="number"` (numeric data), `type="tel"` (phone), `type="date"` (dates — avoids manual string parsing on mobile)
- Do not use `type="number"` for fields with leading zeros or formatted strings (e.g. IBAN, postal code) — use `type="text"` with `inputmode="numeric"` instead
- All filter-bar inputs and selects must use the styled classes: `className="list-search"` for text search, `className="inline-date-input"` for date filters (height 36px in filter bars via `.pl-filter-chips .inline-date-input`)

**Modals**
- Must be scrollable inside when content exceeds viewport height
- Use `overflow-y: auto` on the modal body, not the backdrop
- Do not use `position: fixed` with `height: 100vh` inside a modal — it breaks on mobile browsers with dynamic toolbars

**Typography**
- Minimum body text: 13px. Minimum meta/label text: 11px. Do not go smaller.
- Use `white-space: pre-line` for free-text fields so line breaks render correctly

**Viewports to test manually when in doubt**
- Desktop: 1280 × 800
- Tablet: 768 × 1024
- Mobile: 390 × 844 (iPhone 14)

---

## List UI standards (ALL list pages must follow these rules)

Every list/table view must use the same toolbar and search/filter pattern. Deviations require an explicit decision.

**Toolbar structure**
```tsx
<div className="list-toolbar">
  <input type="search" className="list-search" placeholder="Suchen …" value={search} onChange={…} />
  {/* FilterChips go here, one per filterable dimension */}
  <FilterChip label="Dimension" options={allValues} active={filterSet} onChange={setFilterSet} />
  {/* Primary action button last, pushed right */}
  <button className="btn-primary" style={{ marginLeft: 'auto' }}>+ Neu</button>
</div>
```

**CSS classes (already in globals.css)**
- `.list-toolbar` — `display:flex; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap`
- `.list-search` — flex:1; min-width:180px; styled search input (rounded, border, correct font-size)
- `.filter-chip-wrap` / `.filter-chip-btn` / `.filter-chip-dropdown` / `.filter-chip-option` — multi-select dropdown filter chip

**FilterChip component**
- **Gemeinsame Komponente, nicht kopieren.** Die frühere Regel („copy pattern from `HonorarWizard.tsx`") hat zu 10 Kopien geführt — zehnmal eigenes Tastaturverhalten, zehnmal eigene ARIA-Semantik, zehn Stellen für jede Korrektur. Dieselbe Ursache steckte hinter drei Namen für dieselbe Bedienleiste (`.list-toolbar` / `.pl-toolbar` / `.ls-toolbar`). Neue Verwendungen bitte aus `components/ui/` beziehen; bestehende Kopien werden nach und nach dorthin gezogen.
- Uses `Set<string>` for selected values; null/empty set means "all"
- Click-outside closes via `useRef` + `mousedown` listener
- Shows count badge when active: `§ (2)` plus ein `ChevronDown`-Icon (kein Unicode-Dreieck)
- "Zurücksetzen" button shown when filter is active
- Filter values are derived from the loaded data (no hardcoded lists)
- **Filtering is always client-side** (never add server-side query params for chip filters)

**Which filters to add per list**
Choose dimensions meaningful to the data — typical examples: Projekt, Mitarbeiter, Status, §-Paragraph, Typ. Always include a free-text search. Pre-select filters from `initialProjectId` / nav state when applicable.

---

## Development notes

- **Test suite**: Jest (backend) + Playwright (frontend, smoke tests). Run with `npm test --prefix backend` and `npx playwright test` in `frontend-react/`.
- TypeScript is strict in the frontend; `npx tsc --noEmit` must pass before committing
- The backend is plain JS (no TypeScript)
- Nunjucks templates use `| money` filter (→ `fmtMoney`) and `| date_de` filter
- **Vorbelegungen** liegen als `TENANT_SETTINGS`-Zeilen (KEY/VALUE) unter
  `GET/PUT /stammdaten/defaults` und werden zentral in Einstellungen →
  Vorbelegungen gepflegt. Keys: `default_vat_id`, `default_currency_id`,
  `default_country_id`, `default_company_id`, `default_project_status_id`,
  `default_offer_status_id`, `offer_valid_days`, `default_cash_discount_percent`,
  `default_cash_discount_days`, `default_se_enabled`, `default_se_percent`,
  `default_se_basis`, `default_se_legal_reference`, `default_payment_term_days`.
  Eine neue Vorbelegung braucht **keine Migration**, aber einen Eintrag in `SPEC`
  (`backend/services/tenantDefaults.js`: Recht, Art, Grenzen) — `PUT /defaults` nimmt
  nur Schlüssel dieser Liste an, `GET /defaults` liefert nur sie. Dann das Feld in
  der Vorbelegungen-Seite ergänzen und am Verwendungsort lesen. **Eine leere
  Vorbelegung ist keine Zeile**: Entfernen löscht sie, statt `VALUE = null` zu
  schreiben — Leser, die `{ ...DEFAULTS, ...gespeichert }` bilden, verloren sonst
  ihren Standard (so waren die Budget-Warnungen nach jedem Speichern aus), und
  `Number(null)` ist 0, nicht „nicht gesetzt" (so rechnete „Teilfertige Leistungen"
  mit 0 % statt 100 %). Frontend-Zugriff über
  `useTenantDefaults` / `presetId` (`hooks/useTenantDefaults.ts`,
  `utils/vorbelegung.ts`), damit alle Formulare denselben Query-Key `['defaults']`
  teilen. Vertragsspalten werden **ausschließlich** in
  `backend/services/contractDefaults.js` gefüllt — vier Stellen legen Verträge an
  (Projektanlage, Angebots-Umwandlung, zweimal Import), und genau dieses Driften
  hatte dazu geführt, dass die Skonto-Vorbelegung nirgends angewendet wurde.
- The `dueDateChecker` service runs on a timer at startup — checks invoice due dates
