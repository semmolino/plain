import { apiClient, downloadWithAuth } from './client'

// ── Typen ─────────────────────────────────────────────────────────────────────

export interface ImportFieldDef {
  key:      string
  header:   string
  required: boolean
  example:  string
}

export interface ImportDomain {
  key:        string
  label:      string
  matchLabel: string
  fields:     ImportFieldDef[]
}

export type ImportRowStatus = 'ok' | 'warning' | 'duplicate' | 'error'

export interface ImportRowMessage {
  level: 'error' | 'warn'
  text:  string
}

export interface ImportPreviewRow {
  row:      number
  status:   ImportRowStatus
  messages: ImportRowMessage[]
  display:  Record<string, string | null>
}

export interface ImportSummary {
  total:     number
  ok:        number
  warning:   number
  duplicate: number
  error:     number
}

export interface ImportPreview {
  domain:    string
  filename:  string | null
  headers:   string[]
  mapping:   Record<string, string>
  fields:    ImportFieldDef[]
  summary:   ImportSummary
  rows:      ImportPreviewRow[]
  truncated: boolean
}

export interface ImportCommitResult {
  batchId:  number
  inserted: number
  summary:  ImportSummary
}

export interface ImportBatch {
  id:           number
  domain:       string
  domainLabel:  string
  status:       'committed' | 'rolled_back'
  filename:     string | null
  rowOk:        number
  rowSkipped:   number
  rowError:     number
  createdAt:    string
  rolledBackAt: string | null
}

export type DuplicateMode = 'skip' | 'import'

// ── Calls ─────────────────────────────────────────────────────────────────────

export const fetchImportDomains = () =>
  apiClient.get<{ data: ImportDomain[] }>('/import/domains')

export const downloadImportTemplate = (domain: string) =>
  downloadWithAuth(`/import/${domain}/template`, `plan-und-simple_Vorlage_${domain}.xlsx`)

function buildForm(file: File, mapping?: Record<string, string> | null, duplicateMode?: DuplicateMode) {
  const fd = new FormData()
  fd.append('file', file)
  if (mapping && Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping))
  if (duplicateMode) fd.append('duplicateMode', duplicateMode)
  return fd
}

export const previewImport = (domain: string, file: File, mapping?: Record<string, string> | null) =>
  apiClient.post<{ data: ImportPreview }>(`/import/${domain}/preview`, buildForm(file, mapping))

export const commitImport = (domain: string, file: File, mapping: Record<string, string>, duplicateMode: DuplicateMode) =>
  apiClient.post<{ data: ImportCommitResult }>(`/import/${domain}/commit`, buildForm(file, mapping, duplicateMode))

export const fetchImportBatches = () =>
  apiClient.get<{ data: ImportBatch[] }>('/import/batches')

export const rollbackImportBatch = (id: number) =>
  apiClient.post<{ data: { rolledBack: boolean; deleted: number } }>(`/import/batches/${id}/rollback`, {})
