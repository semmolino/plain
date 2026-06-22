# CLAUDE.md — PlaIn project context

PlaIn is a **multi-tenant business management tool** for architects and planners: offers, projects, invoices (Abschlags- & Schlussrechnungen), contracts, employees, and address management. It is a German-language product deployed as a public SaaS on Railway.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 + Express, `@supabase/supabase-js` (service-role client) |
| Database | Supabase (PostgreSQL), accessed via the JS client — no raw SQL in app code |
| Auth | Custom JWT (`jsonwebtoken` + `bcryptjs`), 8h expiry, secret from `JWT_SECRET` env var |
| Frontend | React 18, TypeScript, Vite, Tanstack Query v5, Zustand, React Router v6 |
| PDF generation | Playwright-chromium + Nunjucks templates (`backend/templates/modern_a/`) |
| Deployment | Railway — pushes to `main` auto-deploy; frontend built inside the container |
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
│   └── migrations/            # SQL files — run MANUALLY in Supabase SQL editor
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
- There is NO database-level RLS enforcing this — a missing `.eq('TENANT_ID', ...)` leaks cross-tenant data

**Error pattern** (services throw, controllers catch):
```js
// Service throws
throw { status: 400, message: 'Pflichtfeld fehlt' }

// Controller catches
} catch (e) {
  return res.status(e?.status || 500).json({ error: e?.message || String(e) })
}
```

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

**Key tables**: `TENANT`, `COMPANY`, `EMPLOYEE`, `ADDRESS`, `CONTACT`, `PROJECT`, `PROJECT_STRUCTURE`, `PROJECT_PROGRESS`, `EMPLOYEE2PROJECT`, `CONTRACT`, `INVOICE`, `PARTIAL_PAYMENT`, `OFFER`, `OFFER_STRUCTURE`, `BILLING_TYPE`, `ROLE`, `VAT`, `TENANT_SETTINGS`.

**BILLING_TYPE_ID**: `1` = fixed-fee (Pauschal), `2` = hourly (Stunden/TEC).

---

## Key business domain patterns

- **Offer → Project conversion** (`POST /angebote/:id/convert`): creates PROJECT + PROJECT_STRUCTURE + EMPLOYEE2PROJECT + CONTRACT from OFFER data. REVENUE/EXTRAS only copied to PROJECT_STRUCTURE if `BILLING_TYPE_ID = 1`; BT=2 nodes start at 0.
- **Invoice wizard**: draft invoice → assign performance amount + TEC bookings → generate line items → finalize.
- **Abschlags- vs. Schlussrechnung**: handled by `INVOICE_TYPE` field; final invoices deduct all prior partial payments.
- **Number ranges**: auto-incremented per company via `next_offer_number()` and `next_project_number()` RPCs.
- **PDF rendering**: `renderDocumentPdf` / `renderOfferPdf` in `services_pdf_render.js` → Nunjucks → Playwright → Buffer. The view model is built first, then passed to the template.

---

## Deployment

1. Push to `main` → Railway rebuilds the Docker image (`npm --prefix frontend-react run build` then `node backend/server.js`)
2. **SQL migrations run manually** in the Supabase SQL editor — files are in `backend/migrations/` numbered `0001_…`
3. Environment variables set in Railway: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `SMTP_*`, `FRONTEND_URL`

---

## Security model — current state and known gaps

**What is in place:**
- bcrypt password hashing (new accounts; legacy plaintext accounts still exist — see auth.js login fallback)
- JWT authentication on all non-`/auth` routes
- Tenant isolation at application layer (services filter by tenantId from JWT)
- HTTPS via Railway

**Known gaps (must fix before public launch):**
- `JWT_SECRET` falls back to hardcoded `"plain-dev-secret-change-me"` if env var is missing — tokens are forgeable in that state
- `app.use(cors())` allows all origins — no allowlist
- Supabase **service-role key** used for all queries (bypasses RLS entirely) — a missing `.eq('TENANT_ID', ...)` in any service leaks data
- No rate limiting on auth endpoints (login, signup, password reset) — brute-force vulnerable
- File uploads stored in `backend/uploads/` with no apparent size/type validation visible
- No input sanitization middleware (XSS protection relies on Supabase parameterization + React's default escaping)
- No CSRF protection (mitigated by Bearer token auth, but worth noting)
- Password reset tokens reuse the same JWT secret with no invalidation mechanism (a used reset link stays valid for 1h)

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
  <FilterChip label="Dimension" options={allValues} selected={filterSet} onChange={setFilterSet} />
  {/* Primary action button last, pushed right */}
  <button className="btn-primary" style={{ marginLeft: 'auto' }}>+ Neu</button>
</div>
```

**CSS classes (already in globals.css)**
- `.list-toolbar` — `display:flex; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap`
- `.list-search` — flex:1; min-width:180px; styled search input (rounded, border, correct font-size)
- `.filter-chip-wrap` / `.filter-chip-btn` / `.filter-chip-dropdown` / `.filter-chip-option` — multi-select dropdown filter chip

**FilterChip component**
- Local component defined per-page (copy pattern from `HonorarWizard.tsx` → `FilterChip`)
- Uses `Set<string>` for selected values; null/empty set means "all"
- Click-outside closes via `useRef` + `mousedown` listener
- Shows count badge when active: `§ (2) ▾`
- "Zurücksetzen" button shown when filter is active
- Filter values are derived from the loaded data (no hardcoded lists)
- **Filtering is always client-side** (never add server-side query params for chip filters)

**Which filters to add per list**
Choose dimensions meaningful to the data — typical examples: Projekt, Mitarbeiter, Status, §-Paragraph, Typ. Always include a free-text search. Pre-select filters from `initialProjectId` / nav state when applicable.

---

## Development notes

- **Test suite**: Jest (backend, 24 tests) + Playwright (frontend, smoke tests). Run with `npm test --prefix backend` and `npx playwright test` in `frontend-react/`.
- TypeScript is strict in the frontend; `npx tsc --noEmit` must pass before committing
- The backend is plain JS (no TypeScript)
- Nunjucks templates use `| money` filter (→ `fmtMoney`) and `| date_de` filter
- `TENANT_SETTINGS` keys used in code: `default_vat_id`, `default_currency_id`
- The `dueDateChecker` service runs on a timer at startup — checks invoice due dates
