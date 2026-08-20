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
  domain:     string
  filename:   string | null
  /** Gelesenes Tabellenblatt (immer das erste der Datei). */
  sheetName:  string
  /** Alle Blätter der Datei — weitere Blätter werden nicht gelesen. */
  sheetNames: string[]
  headers:   string[]
  mapping:   Record<string, string>
  /** 'remembered' = Zuordnung aus dem letzten Import dieses Bereichs übernommen. */
  mappingSource: 'auto' | 'remembered' | 'manual'
  /** Ob dieser Bereich Dubletten mit dem Bestand zusammenführen kann. */
  mergeable: boolean
  fields:    ImportFieldDef[]
  summary:   ImportSummary
  rows:      ImportPreviewRow[]
  truncated: boolean
}

export interface ImportCommitResult {
  batchId:  number
  inserted: number
  merged?:  number
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

export type DuplicateMode = 'skip' | 'import' | 'merge'
export type StructureMode = 'single' | 'hoai'
export type DocType = 'partial' | 'invoice'

// ── Calls ─────────────────────────────────────────────────────────────────────

export const fetchImportDomains = () =>
  apiClient.get<{ data: ImportDomain[] }>('/import/domains')

export const downloadImportTemplate = (domain: string) =>
  downloadWithAuth(`/import/${domain}/template`, `plan-und-simple_Vorlage_${domain}.xlsx`)

function buildForm(file: File, mapping?: Record<string, string> | null, duplicateMode?: DuplicateMode, structureMode?: StructureMode, docType?: DocType, excludeRows?: number[]) {
  const fd = new FormData()
  fd.append('file', file)
  if (mapping && Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping))
  if (duplicateMode) fd.append('duplicateMode', duplicateMode)
  if (structureMode) fd.append('structureMode', structureMode)
  if (docType) fd.append('docType', docType)
  if (excludeRows && excludeRows.length) fd.append('excludeRows', JSON.stringify(excludeRows))
  return fd
}

export const previewImport = (domain: string, file: File, mapping?: Record<string, string> | null) =>
  apiClient.post<{ data: ImportPreview }>(`/import/${domain}/preview`, buildForm(file, mapping))

export const commitImport = (domain: string, file: File, mapping: Record<string, string>, duplicateMode: DuplicateMode, structureMode?: StructureMode, docType?: DocType, excludeRows?: number[]) =>
  apiClient.post<{ data: ImportCommitResult }>(`/import/${domain}/commit`, buildForm(file, mapping, duplicateMode, structureMode, docType, excludeRows))

/** Strukturvorlage, bereits mit den eigenen Projekten und den HOAI-Phasen gefüllt. */
export const downloadStructurePrefill = () =>
  downloadWithAuth('/import/project_structure/prefill', 'plan-und-simple_Vorlage_project_structure_vorbefuellt.xlsx')

/** Nicht importierbare Zeilen als Excel — zum Korrigieren und erneut Hochladen. */
export const downloadImportErrors = (domain: string, file: File, mapping: Record<string, string>) =>
  downloadWithAuth(`/import/${domain}/errors`, `plan-und-simple_Fehler_${domain}.xlsx`, buildForm(file, mapping))

export const fetchImportBatches = () =>
  apiClient.get<{ data: ImportBatch[] }>('/import/batches')

export const rollbackImportBatch = (id: number) =>
  apiClient.post<{ data: { rolledBack: boolean; deleted: number; restored?: number } }>(`/import/batches/${id}/rollback`, {})
