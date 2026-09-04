# CLAUDE.md — plan&simple project context

**Produktname: „plan&simple"** (kleingeschrieben, mit Ampersand) — so heißt es in der Oberfläche, im Logo und gegenüber Nutzern. Der alte Name „PlaIn" stammt aus der Frühphase; **in jedem user-facing Text „plan&simple" verwenden**. Code-Bezeichner/Ordner (`plain/`, `tenantId`, …) bleiben unverändert.

plan&simple is a **multi-tenant business management tool** for architects and planners: offers, projects, invoices (Abschlags- & Schlussrechnungen), contracts, employees, and address management. It is a German-language product deployed as a public SaaS on **Scalingo**.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 + Express, `@supabase/supabase-js` (service-role client) |
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
│   └── migrations/            # SQL files — MANUELL gegen die Scalingo-DB einspielen
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
| Table + column names | `UPPER_CASE` (`OFFER`, `NAME_LONG`) |
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

**Key tables**: `TENANT`, `COMPANY`, `EMPLOYEE`, `ADDRESS`, `CONTACT`, `PROJECT`, `PROJECT_STRUCTURE`, `PROJECT_PROGRESS`, `EMPLOYEE2PROJECT`, `CONTRACT`, `INVOICE`, `PARTIAL_PAYMENT`, `OFFER`, `OFFER_STRUCTURE`, `BILLING_TYPE`, `ROLE`, `VAT`, `TENANT_SETTINGS`, `WIP_CLOSING`/`WIP_CLOSING_LINE`.

**BILLING_TYPE_ID**: `1` = fixed-fee (Pauschal), `2` = hourly (Stunden/TEC).

---

## Key business domain patterns

- **Offer → Project conversion** (`POST /angebote/:id/convert`): creates PROJECT + PROJECT_STRUCTURE + EMPLOYEE2PROJECT + CONTRACT from OFFER data. REVENUE/EXTRAS only copied to PROJECT_STRUCTURE if `BILLING_TYPE_ID = 1`; BT=2 nodes start at 0.
- **Invoice wizard**: draft invoice → assign performance amount + TEC bookings → generate line items → finalize.
- **Abschlags- vs. Schlussrechnung**: handled by `INVOICE_TYPE` field; final invoices deduct all prior partial payments.
- **Number ranges**: auto-incremented per company via `next_offer_number()` and `next_project_number()` RPCs.
- **PDF rendering**: `renderDocumentPdf` / `renderOfferPdf` in `services_pdf_render.js` → Nunjucks → Playwright → Buffer. The view model is built first, then passed to the template.
- **Teilfertige Leistungen** (`services/wipReport.js`, Report unter Projektdaten):
  der kaufmännische Abschluss. Je Projekt und Stichtag `unfertig = max(0,
  Leistungswert − abgerechnet)`, HGB-Ansatz `min(Kostenanteil, unfertig)`.
  Zwei Regeln sind bindend und nicht „Aufräumsache": Aktivposten und erhaltene
  Anzahlungen werden **projektweise getrennt** geführt und nie saldiert (§ 246
  Abs. 2 HGB), und der HGB-Wert enthält **keinen** anteiligen Gewinn (§ 252
  Abs. 1 Nr. 4 HGB). Stichtagswerte in der Vergangenheit hängen an den
  `PROJECT_PROGRESS`-Snapshots — fehlt einer, weist der Report das aus statt
  eine 0 zu zeigen. Optional daneben: ein zweiter Wertansatz für die
  Steuerbilanz und eine Gegenprobe des Leistungsstands über eine
  Zielkostenquote — beide bleiben ohne gepflegte Einstellung ganz aus, statt
  eine 0 zu behaupten. Konzept: `docs/TEILFERTIGE_LEISTUNGEN_CONCEPT.md`.

---

## Deployment

**Gehostet wird auf Scalingo** (`planandsimple`), nicht mehr auf Railway. Railway war
bis zum Umzug die produktive Instanz; Erwähnungen davon in älteren Dokumenten
beziehen sich auf diesen früheren Stand.

1. Push to `main` → Scalingo baut über das Node-Buildpack (`scalingo-postbuild` in der
   Root-`package.json`), Start über `Procfile` → `bin/start-web.sh`
2. **SQL-Migrationen manuell einspielen**, gegen die Scalingo-Datenbank (NICHT mehr im Supabase-Editor):
   `scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0129_….sql'`
   Dateien liegen in `backend/migrations/`, nummeriert `0001_…`
3. Umgebungsvariablen über `scalingo --app planandsimple env-set …` bzw. das Dashboard:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `SMTP_*`, `FRONTEND_URL`
4. Runbook: `docs/SCALINGO_DEPLOY_RUNBOOK.md`

**`DISABLE_BACKGROUND_JOBS` gehört NICHT auf die produktive Instanz.** Das Flag
verhindert, dass die Hintergrund-Checker starten — ohne sie entsteht keine einzige
geplante Benachrichtigung (weder Push noch in-app). Es war ausschließlich für den
Parallelbetrieb gedacht, als Scalingo und Railway gleichzeitig auf dieselbe Supabase
zeigten. Läuft nur noch eine Instanz, muss es weg. Prüfbar in der Oberfläche unter
Einstellungen → Benachrichtigungen → „Zustellung prüfen".

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
- Startabbruch bei fehlendem/unsicherem `JWT_SECRET`, fehlender Dateiablage oder fehlendem Datenbankweg (`server.js`)
- CORS-Allowlist (`CORS_ORIGINS`/`FRONTEND_URL`), nur auf `/api`; helmet; `trust proxy`
- Rate-Limiter auf allen fünf Auth-Wegen; Reset-Links sind One-Time (Passwort-Fingerabdruck)
- Upload: MIME-Allowlist + 10 MB; Auslieferung über `services/fileResponse.js` (Inline-Allowlist, `nosniff`, Sandbox-CSP)
- Sucheingaben in PostgREST-Filtern über `services/pgrestFilter.js` neutralisiert
- Owner-Konsole: eigenes Secret, eigene Audience, 2 h TTL, TOTP, Audit-Log, `SESSION_EPOCH`
- Automatischer Scan: `node scripts/security-scan.mjs` (CI-Job `security`, täglich mit `--deps`)

- Sitzungs-Rücknahme über `EMPLOYEE.SESSION_EPOCH` (`middleware/sessionGuard.js`): Passwortwechsel, Reset und Rollenänderung beenden laufende Sitzungen sofort. **Der Guard hängt in der authChain hinter `tenantScope`** — davor liegt kein Mandanten-Claim an, und die EMPLOYEE-Abfrage würde unter RLS null Zeilen liefern, also jeden aussperren.
- Upload-Rechte nach `asset_type` (`routes/assets.js`): `AVATAR` ist Selbstbedienung, alles andere verlangt ein bestehendes Recht; unbekannte Arten fail-closed.

- Drosselung teurer Endpunkte (PDF, Reports) **pro Konto, nicht pro IP** (`middleware/rateLimit.js`) — ein Büro hinter einer NAT-Adresse darf sich nicht selbst aussperren. Die Limiter hängen deshalb hinter `authMiddleware`.
- Progressive Verzögerung bei Fehlversuchen **je Konto** (`middleware/loginAttempts.js`) — bewusst keine Sperre: die wäre ein Weg, einen bekannten Nutzer gezielt auszusperren.
- **Registrierung neuer Mandanten braucht zwei Tore** (`services/signupApproval.js`, Migration 0135): E-Mail-Bestätigung des Anmelders, dann Freigabe in der Owner-Konsole (Tab „Registrierungen"). Bis dahin ist die Anmeldung gesperrt — geprüft **nach** der Passwortprüfung, damit der Zustand eines Mandanten nichts über ihn verrät. Ablehnen löscht den Antrag, aber **nur** im Zustand pending. Der Spaltenstandard von `SIGNUP_STATE` ist `active`: Import, Demo-Daten und manuelles SQL sollen weiterhin benutzbare Mandanten erzeugen.
- Serverfehler tragen nach außen eine allgemeine Meldung plus Fehlerkennung (`middleware/errorSanitizer.js`); das Original steht im Protokoll. Fachfehler mit `status < 500` bleiben unberührt. Ein 500er, dessen Meldung der Nutzer braucht, kennzeichnet sich mit `userFacing: true`.

**Offen (Stand 2026-09-04):**
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
- Navigation: Einträge **nur** in `components/layout/navItems.ts` pflegen — Seiten- und Bottom-Nav speisen sich daraus. `mobileRank` entscheidet, was auf dem Handy in der Leiste landet (max. 5 + „Mehr").
- Regressionstests für diese Punkte: `frontend-react/tests/a11y.spec.ts`.

---

## UI/UX — responsive & mobile rules

These rules apply to every feature. Playwright smoke tests in `frontend-react/tests/` enforce them automatically in CI.

**Layout**
- No horizontal scroll at any viewport width (test: `document.body.scrollWidth ≤ viewport.width + 2`)
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
  Eine neue Vorbelegung braucht **keine Migration** — Feld in `VorbelegungenSection`
  (AdminPage) ergänzen und am Verwendungsort lesen. Frontend-Zugriff über
  `useTenantDefaults` / `presetId` (`hooks/useTenantDefaults.ts`,
  `utils/vorbelegung.ts`), damit alle Formulare denselben Query-Key `['defaults']`
  teilen. Vertragsspalten werden **ausschließlich** in
  `backend/services/contractDefaults.js` gefüllt — vier Stellen legen Verträge an
  (Projektanlage, Angebots-Umwandlung, zweimal Import), und genau dieses Driften
  hatte dazu geführt, dass die Skonto-Vorbelegung nirgends angewendet wurde.
- The `dueDateChecker` service runs on a timer at startup — checks invoice due dates
