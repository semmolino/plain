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

## UI/UX — responsive & mobile rules

These rules apply to every feature. Playwright smoke tests in `frontend-react/tests/` enforce them automatically in CI.

**Layout**
- No horizontal scroll at any viewport width (test: `document.body.scrollWidth ≤ viewport.width + 2`)
- Bottom nav (`.bottom-nav`) must always be visible and reachable — never obscured by modals or sticky headers
- Page content must not be hidden behind the fixed bottom nav — keep `padding-bottom` ≥ 64px on all page roots

**Touch targets**
- Minimum 44 × 44 px for every interactive element (buttons, nav items, links, toggles)
- `.bottom-nav-item` items are currently 58px — do not reduce
- Prefer `gap` over reducing hit areas when space is tight

**Inputs**
- Always use the correct `type` attribute for mobile keyboards: `type="email"`, `type="number"` (numeric data), `type="tel"` (phone), `type="date"` (dates — avoids manual string parsing on mobile)
- Do not use `type="number"` for fields with leading zeros or formatted strings (e.g. IBAN, postal code) — use `type="text"` with `inputmode="numeric"` instead

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

## Development notes

- **Test suite**: Jest (backend, 24 tests) + Playwright (frontend, smoke tests). Run with `npm test --prefix backend` and `npx playwright test` in `frontend-react/`.
- TypeScript is strict in the frontend; `npx tsc --noEmit` must pass before committing
- The backend is plain JS (no TypeScript)
- Nunjucks templates use `| money` filter (→ `fmtMoney`) and `| date_de` filter
- `TENANT_SETTINGS` keys used in code: `default_vat_id`, `default_currency_id`
- The `dueDateChecker` service runs on a timer at startup — checks invoice due dates
