-- Stage A: PDF templates + assets
-- Execute in Supabase SQL editor.

-- 1) Generic assets (logo, signatures, etc.)
create table if not exists public.ASSET (
  ID bigserial primary key,
  COMPANY_ID bigint not null,
  ASSET_TYPE text not null, -- e.g. LOGO
  FILE_NAME text not null,
  MIME_TYPE text not null,
  FILE_SIZE bigint not null,
  STORAGE_KEY text not null,
  SHA256 text null,
  CREATED_AT timestamptz not null default now()
);

create index if not exists idx_asset_company on public.ASSET(COMPANY_ID);
create index if not exists idx_asset_type_company on public.ASSET(COMPANY_ID, ASSET_TYPE);

-- 2) Document templates (layout in code, theme in DB)
create table if not exists public.DOCUMENT_TEMPLATE (
  ID bigserial primary key,
  COMPANY_ID bigint not null,
  NAME text not null,
  DOC_TYPE text not null, -- INVOICE, PARTIAL_PAYMENT
  LAYOUT_KEY text not null, -- modern_a, classic_a
  THEME_JSON jsonb not null default '{}'::jsonb,
  LOGO_ASSET_ID bigint null,
  IS_DEFAULT boolean not null default false,
  IS_ACTIVE boolean not null default true,
  CREATED_AT timestamptz not null default now(),
  UPDATED_AT timestamptz not null default now()
);

create index if not exists idx_doc_template_company_type on public.DOCUMENT_TEMPLATE(COMPANY_ID, DOC_TYPE);
create index if not exists idx_doc_template_default on public.DOCUMENT_TEMPLATE(COMPANY_ID, DOC_TYPE, IS_DEFAULT);

alter table public.DOCUMENT_TEMPLATE
  drop constraint if exists fk_document_template_logo_asset;

alter table public.DOCUMENT_TEMPLATE
  add constraint fk_document_template_logo_asset
  foreign key (LOGO_ASSET_ID) references public.ASSET(ID) on delete set null;

-- 3) Optional snapshot columns on invoice tables (safe adds)
alter table public.INVOICE add column if not exists DOCUMENT_TEMPLATE_ID bigint null;
alter table public.INVOICE add column if not exists DOCUMENT_LAYOUT_KEY_SNAPSHOT text null;
alter table public.INVOICE add column if not exists DOCUMENT_THEME_SNAPSHOT_JSON jsonb null;
alter table public.INVOICE add column if not exists DOCUMENT_LOGO_ASSET_ID_SNAPSHOT bigint null;
alter table public.INVOICE add column if not exists DOCUMENT_PDF_ASSET_ID bigint null;
alter table public.INVOICE add column if not exists DOCUMENT_RENDERED_AT timestamptz null;

alter table public.PARTIAL_PAYMENT add column if not exists DOCUMENT_TEMPLATE_ID bigint null;
alter table public.PARTIAL_PAYMENT add column if not exists DOCUMENT_LAYOUT_KEY_SNAPSHOT text null;
alter table public.PARTIAL_PAYMENT add column if not exists DOCUMENT_THEME_SNAPSHOT_JSON jsonb null;
alter table public.PARTIAL_PAYMENT add column if not exists DOCUMENT_LOGO_ASSET_ID_SNAPSHOT bigint null;
alter table public.PARTIAL_PAYMENT add column if not exists DOCUMENT_PDF_ASSET_ID bigint null;
alter table public.PARTIAL_PAYMENT add column if not exists DOCUMENT_RENDERED_AT timestamptz null;

-- 4) Optional FK to rendered PDF stored as ASSET
alter table public.INVOICE
  drop constraint if exists fk_invoice_pdf_asset;

alter table public.INVOICE
  add constraint fk_invoice_pdf_asset
  foreign key (DOCUMENT_PDF_ASSET_ID) references public.ASSET(ID) on delete set null;

alter table public.PARTIAL_PAYMENT
  drop constraint if exists fk_pp_pdf_asset;

alter table public.PARTIAL_PAYMENT
  add constraint fk_pp_pdf_asset
  foreign key (DOCUMENT_PDF_ASSET_ID) references public.ASSET(ID) on delete set null;
