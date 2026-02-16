# Stage A – PDF Rendering (Playwright + Templates)

## 1) Database setup (Supabase / Postgres)
Run this SQL script in Supabase:
- `backend/sql/stageA_document_templates.sql`

It creates:
- `ASSET`
- `DOCUMENT_TEMPLATE`
- optional snapshot columns on `INVOICE` and `PARTIAL_PAYMENT`

## 2) Backend dependencies
In `backend/` run:

```bash
npm install
npx playwright install chromium
```

If you use a Linux server/Docker environment, you may need system deps for Chromium.
Playwright can install them automatically in many environments, otherwise consult Playwright docs.

## 3) API endpoints
- Templates:
  - `GET /api/document-templates?company_id=..&doc_type=INVOICE`
  - `POST /api/document-templates`
  - `PATCH /api/document-templates/:id`
  - `POST /api/document-templates/:id/set-default`

- Assets:
  - `POST /api/assets/upload` (multipart form-data: `file`, `company_id`, `asset_type=LOGO`)
  - `GET /api/assets/:id`

- PDF:
  - `GET /api/invoices/:id/pdf?template_id=...`
  - `GET /api/partial-payments/:id/pdf?template_id=...`

## 4) Templates
Code-based layout:
- `backend/templates/modern_a/*`

User-customizable theme:
- stored in `DOCUMENT_TEMPLATE.THEME_JSON`
