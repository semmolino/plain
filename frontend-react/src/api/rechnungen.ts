import { apiClient, downloadWithAuth, openPdfWithAuth } from './client'

// ── Lookup types ──────────────────────────────────────────────────────────────

export interface Company      { ID: number; COMPANY_NAME_1: string }
export interface VatRate      { ID: number; VAT: string; VAT_PERCENT: number }
export interface PaymentMeans { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface Contract     { ID: number; NAME_SHORT: string; NAME_LONG: string; PROJECT_ID: number }

// ── Invoice types ─────────────────────────────────────────────────────────────

export type InvoiceType = 'rechnung' | 'schlussrechnung' | 'teilschlussrechnung' | 'stornorechnung'

export interface Invoice {
  ID:                   number
  INVOICE_NUMBER:       string | null
  INVOICE_DATE:         string | null
  DUE_DATE:             string | null
  TOTAL_AMOUNT_NET:     number | null
  TAX_AMOUNT_NET:       number | null
  TOTAL_AMOUNT_GROSS:   number | null
  STATUS_ID:            number
  PROJECT_ID:           number | null
  CONTRACT_ID:          number | null
  VAT_PERCENT:          number | null
  PROJECT:              string | null
  CONTRACT:             string | null
  CONTACT:              string | null
  ADDRESS_NAME_1:       string | null
  AMOUNT_PAYED_GROSS:   number | null
  COMMENT:              string | null
  INVOICE_TYPE:         InvoiceType | null
}

export interface PartialPayment {
  ID:                           number
  PARTIAL_PAYMENT_NUMBER:       string | null
  PARTIAL_PAYMENT_DATE:         string | null
  DUE_DATE:                     string | null
  TOTAL_AMOUNT_NET:             number | null
  TAX_AMOUNT_NET:               number | null
  TOTAL_AMOUNT_GROSS:           number | null
  AMOUNT_NET:                   number | null
  AMOUNT_EXTRAS_NET:            number | null
  STATUS_ID:                    number
  PROJECT_ID:                   number | null
  CONTRACT_ID:                  number | null
  VAT_PERCENT:                  number | null
  PROJECT:                      string | null
  CONTRACT:                     string | null
  COMMENT:                      string | null
  CANCELS_PARTIAL_PAYMENT_ID:   number | null
}

export interface BillingProposal {
  performance_suggested: number | null
  performance_amount:    number | null
  bookings_sum:          number | null
  amount_net:            number | null
  amount_extras_net:     number | null
  total_amount_net:      number | null
  total_amount_gross:    number | null
  vat_percent:           number | null
}

export interface TecEntry {
  ID:                  number
  DATE_VOUCHER:        string | null
  EMPLOYEE_SHORT_NAME: string | null
  POSTING_DESCRIPTION: string | null
  SP_TOT:              number | null
  ASSIGNED:            boolean
}

export interface FinalPhase {
  ID:                   number
  FATHER_ID:            number | null
  NAME_SHORT:           string
  NAME_LONG:            string | null
  BILLING_TYPE_ID:      number | null
  REVENUE_COMPLETION:   number | null
  EXTRAS_AMOUNT:        number | null
  TOTAL_EARNED:         number | null
  ALREADY_BILLED:       number | null
  AMOUNT_NET:           number | null
  AMOUNT_EXTRAS_NET:    number | null
  SELECTED:             boolean
  CLOSED_BY_INVOICE_ID: number | null
  CLOSED:               boolean
}

export interface FinalDeduction {
  ID:                      number
  PARTIAL_PAYMENT_NUMBER:  string | null
  PARTIAL_PAYMENT_DATE:    string | null
  AMOUNT_NET:              number | null
  TOTAL_AMOUNT_NET:        number | null
}

export interface FinalTotals {
  phaseTotal:       number
  deductionsTotal:  number
  totalNet:         number
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export const fetchCompanies = () =>
  apiClient.get<{ data: Company[] }>('/stammdaten/companies')

export const searchVat = (q: string) =>
  apiClient.get<{ data: VatRate[] }>(`/stammdaten/vat/search?q=${encodeURIComponent(q)}`)

export const searchPaymentMeans = (q: string) =>
  apiClient.get<{ data: PaymentMeans[] }>(`/stammdaten/payment-means/search?q=${encodeURIComponent(q)}`)

export const searchContracts = (projectId: number, q: string) =>
  apiClient.get<{ data: Contract[] }>(
    `/projekte/contracts/search?project_id=${projectId}&q=${encodeURIComponent(q)}`
  )

// ── Invoices ──────────────────────────────────────────────────────────────────

export const fetchInvoices = (q = '') =>
  apiClient.get<{ data: Invoice[] }>(`/invoices?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`)

export const initInvoice = (body: {
  company_id: number; employee_id: number; project_id: number
  contract_id: number; invoice_type?: InvoiceType
}) => apiClient.post<{ id: number }>('/invoices/init', body)

export const getInvoice = (id: number) =>
  apiClient.get<{ data: { inv: Invoice } }>(`/invoices/${id}`)

export const patchInvoice = (id: number, body: Partial<{
  invoice_number: string; invoice_date: string; due_date: string
  billing_period_start: string; billing_period_finish: string
  vat_id: number; payment_means_id: number; comment: string
}>) => apiClient.patch<{ ok: boolean }>(`/invoices/${id}`, body)

export const getInvoiceBillingProposal = (id: number) =>
  apiClient.get<{ data: BillingProposal }>(`/invoices/${id}/billing-proposal`)

export const putInvoicePerformance = (id: number, amount: number) =>
  apiClient.put<{ data: BillingProposal }>(`/invoices/${id}/performance`, { amount })

export const getInvoiceTec = (id: number) =>
  apiClient.get<{ data: TecEntry[]; hasBt2: boolean }>(`/invoices/${id}/tec`)

export const postInvoiceTec = (id: number, body: {
  ids_assign: number[]; ids_unassign: number[]; performance_amount?: number
}) => apiClient.post<{ data: BillingProposal }>(`/invoices/${id}/tec`, body)

export const bookInvoice = (id: number) =>
  apiClient.post<{ success: boolean; invoice_number: string }>(`/invoices/${id}/book`, {})

export const deleteInvoice = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/invoices/${id}`)

export const cancelInvoice = (id: number) =>
  apiClient.post<{ id: number }>(`/invoices/${id}/cancel`, {})

export const openInvoicePdf = (id: number) =>
  openPdfWithAuth(`/invoices/${id}/pdf?preview=1`)

export const openPpPdf = (id: number) =>
  openPdfWithAuth(`/partial-payments/${id}/pdf?preview=1`)

export function downloadInvoiceEinvoice(
  id: number,
  invoiceType: InvoiceType | null | undefined,
  invoiceNumber: string | null | undefined,
  format: 'ubl' | 'cii',
  profile = 'EN16931'
): Promise<void> {
  const isFinal = invoiceType === 'schlussrechnung' || invoiceType === 'teilschlussrechnung'
  const base    = isFinal ? `/final-invoices/${id}` : `/invoices/${id}`
  const params  = new URLSearchParams({ download: '1' })
  if (format === 'cii') params.set('profile', profile)
  const num      = invoiceNumber || String(id)
  const fileName = format === 'ubl' ? `XRechnung_${num}.xml` : `ZUGFeRD_${num}.xml`
  return downloadWithAuth(`${base}/einvoice/${format}?${params}`, fileName)
}

// ── Partial Payments ──────────────────────────────────────────────────────────

export const fetchPartialPayments = (q = '') =>
  apiClient.get<{ data: PartialPayment[] }>(`/partial-payments?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`)

export const initPartialPayment = (body: {
  company_id: number; employee_id: number; project_id: number; contract_id: number
}) => apiClient.post<{ id: number }>('/partial-payments/init', body)

export const getPartialPayment = (id: number) =>
  apiClient.get<{ data: { pp: PartialPayment } }>(`/partial-payments/${id}`)

export const patchPartialPayment = (id: number, body: Partial<{
  partial_payment_number: string; partial_payment_date: string; due_date: string
  billing_period_start: string; billing_period_finish: string
  amount_net: number; amount_extras_net: number
  vat_id: number; payment_means_id: number; comment: string
}>) => apiClient.patch<{ success: boolean }>(`/partial-payments/${id}`, body)

export const getPpBillingProposal = (id: number) =>
  apiClient.get<{ data: BillingProposal }>(`/partial-payments/${id}/billing-proposal`)

export const putPpPerformance = (id: number, amount: number) =>
  apiClient.put<{ data: BillingProposal }>(`/partial-payments/${id}/performance`, { amount })

export const getPpTec = (id: number) =>
  apiClient.get<{ data: TecEntry[]; hasBt2: boolean }>(`/partial-payments/${id}/tec`)

export const postPpTec = (id: number, body: {
  ids_assign: number[]; ids_unassign: number[]; performance_amount?: number
}) => apiClient.post<{ data: BillingProposal }>(`/partial-payments/${id}/tec`, body)

export const bookPartialPayment = (id: number) =>
  apiClient.post<{ success: boolean }>(`/partial-payments/${id}/book`, {})

export const deletePartialPayment = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/partial-payments/${id}`)

export const cancelPartialPayment = (id: number) =>
  apiClient.post<{ id: number }>(`/partial-payments/${id}/cancel`, {})


export function downloadPpEinvoice(
  id: number,
  ppNumber: string | null | undefined,
  format: 'ubl' | 'cii',
  profile = 'EN16931'
): Promise<void> {
  const params   = new URLSearchParams({ download: '1' })
  if (format === 'cii') params.set('profile', profile)
  const num      = ppNumber || String(id)
  const fileName = format === 'ubl' ? `XRechnung_${num}.xml` : `ZUGFeRD_${num}.xml`
  return downloadWithAuth(`/partial-payments/${id}/einvoice/${format}?${params}`, fileName)
}

// ── Final Invoices ────────────────────────────────────────────────────────────

export const getFinalInvoicePhases = (id: number) =>
  apiClient.get<{ data: FinalPhase[] }>(`/final-invoices/${id}/phases`)

export const saveFinalInvoicePhases = (id: number, structure_ids: number[]) =>
  apiClient.post<{ ok: boolean } & FinalTotals>(`/final-invoices/${id}/phases`, { structure_ids })

export const getFinalInvoiceDeductions = (id: number) =>
  apiClient.get<{ data: FinalDeduction[] }>(`/final-invoices/${id}/deductions`)

export const saveFinalInvoiceDeductions = (id: number, items: { partial_payment_id: number; deduction_amount_net: number }[]) =>
  apiClient.post<{ ok: boolean } & FinalTotals>(`/final-invoices/${id}/deductions`, { items })

export const bookFinalInvoice = (id: number) =>
  apiClient.post<{ success: boolean; invoice_number: string }>(`/final-invoices/${id}/book`, {})
