import { apiClient, openPdfWithAuth } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MahnungRow {
  sourceType:            'invoice' | 'pp'
  sourceId:              number
  number:                string
  invoiceDate:           string | null
  dueDate:               string
  daysOverdue:           number
  totalGross:            number
  projectId:             number | null
  contractId:            number | null
  projectNumber:         string | null
  projectName:           string | null
  contractName:          string | null
  addressName1:          string | null
  contact:               string | null
  // Mahnung state (all null = no MAHNUNG record yet)
  mahnungId:             number | null
  mahnstufe:             number          // 0 = no dunning initiated
  lastMahnungDate:       string | null
  nextMahnungDate:       string | null
  responsibleEmployeeId: number | null
  isClosed:              boolean
  closeReason:           string | null
  inKlaerung:            boolean
  notes:                 string | null
  history:               MahnungHistoryEntry[]
}

export interface MahnungStats {
  totalOpen:           number
  totalClosed:         number
  byStufe:             Record<number, number>
  overdueActionsCount: number
}

export interface MahnungHistoryEntry {
  mahnstufe:    number
  dateAction:   string
  emailSent:    boolean
  emailTo:      string | null
  emailSubject: string | null
  feeAmount:    number
}

export interface MahnungSettingsLevel {
  mahnstufe:     number
  label:         string
  daysAfterDue:  number
  daysAfterPrev: number
  fee:           number
  headerText:    string | null
  footerText:    string | null
}

export interface TextTemplate {
  documentType: string
  headerText:   string | null
  footerText:   string | null
}

export type TextTemplateType =
  | 'invoice_abschlags'
  | 'invoice_rechnung'
  | 'invoice_schluss'
  | 'invoice_storno'

export const TEXT_TEMPLATE_LABELS: Record<TextTemplateType, string> = {
  invoice_abschlags: 'Abschlags-/Anzahlungsrechnung',
  invoice_rechnung:  'Rechnung',
  invoice_schluss:   'Schluss-/Teilschlussrechnung',
  invoice_storno:    'Stornierung',
}

// ── API functions ─────────────────────────────────────────────────────────────

export const fetchMahnungen = () =>
  apiClient.get<{ data: MahnungRow[] }>('/mahnungen')

export const upsertMahnung = (payload: {
  invoice_id?:             number | null
  pp_id?:                  number | null
  mahnstufe?:              number
  last_mahnung_date?:      string | null
  next_mahnung_date?:      string | null
  responsible_employee_id?: number | null
  is_closed?:              boolean
  close_reason?:           string | null
  in_klaerung?:            boolean
  notes?:                  string | null
}) => apiClient.put<{ id: number }>('/mahnungen/upsert', payload)

export const sendMahnungEmail = (
  mahnungId: number,
  payload: { emailTo: string; emailSubject: string; emailBody: string }
) => apiClient.post<{ sent: boolean }>(`/mahnungen/${mahnungId}/send`, payload)

export const openMahnungPdf = (mahnungId: number) =>
  openPdfWithAuth(`/mahnungen/${mahnungId}/pdf`)

export const fetchMahnungHistory = (mahnungId: number) =>
  apiClient.get<{ data: MahnungHistoryEntry[] }>(`/mahnungen/${mahnungId}/history`)

export const fetchMahnungSettings = () =>
  apiClient.get<{ data: MahnungSettingsLevel[] }>('/mahnungen/settings')

export const saveMahnungSettings = (levels: MahnungSettingsLevel[]) =>
  apiClient.put<{ ok: boolean }>('/mahnungen/settings', { levels })

export const fetchTextTemplates = () =>
  apiClient.get<{ data: TextTemplate[] }>('/mahnungen/text-templates')

export const saveTextTemplate = (
  documentType: string,
  payload: { headerText: string | null; footerText: string | null }
) => apiClient.put<{ ok: boolean }>(`/mahnungen/text-templates/${documentType}`, payload)

export const fetchMahnungStats = () =>
  apiClient.get<{ data: MahnungStats }>('/mahnungen/stats')
