import {
  initPartialPayment, patchPartialPayment, getPartialPayment, getPpBillingProposal,
  putPpPerformance, getPpTec, postPpTec, bookPartialPayment, bookPartialPaymentForce, deletePartialPayment,
  openPpPdf, downloadPpEinvoice,
  initInvoice, patchInvoice, getInvoice, getInvoiceBillingProposal,
  putInvoicePerformance, getInvoiceTec, postInvoiceTec, bookInvoice, bookInvoiceForce, deleteInvoice,
  openInvoicePdf, downloadInvoiceEinvoice,
  type BillingProposal, type TecEntry,
} from '@/api/rechnungen'

/**
 * Ein Assistent, drei Belegarten (UI-Pilot Runde 2).
 *
 * Einzelrechnung und Gutschrift liefen bis Runde 2 durch eine Kopie des alten
 * Abschlag-Assistenten — mit allen Fehlern, die Runde 1 beim Abschlag behoben
 * hatte: Buchen ohne Recht und ohne Rueckfrage, PDF/XML fuer jeden, XML ohne
 * die Nachlaesse, „Entwurf speichern" ohne Fehlermeldung. Statt die Kopie ein
 * zweites Mal nachzuziehen, faehrt der Abschlag-Assistent jetzt alle drei,
 * und was sich unterscheidet, steht hier.
 */
export type WizardKind = 'abschlag' | 'rechnung' | 'gutschrift'

type Ref = { ABBR: string | null; NAME: string | null } | null | undefined
type AnyBody = Record<string, unknown>

export interface WizardApi {
  kind:        WizardKind
  /** „Abschlagsrechnung", „Rechnung", „Gutschrift" */
  noun:        string
  /** Spalte des Belegdatums in der gespeicherten Zeile */
  dateCol:     'ADVANCE_INVOICE_DATE' | 'INVOICE_DATE'
  /** Feld des Belegdatums in der PATCH-Nutzlast */
  dateKey:     'advance_invoice_date' | 'invoice_date'
  /** Sicherheitseinbehalt nur im Phasenmodell (Abschlag) */
  supportsSe:  boolean
  attachments: 'partial-payments' | 'invoices'
  listKey:     'partial-payments' | 'invoices'
  init:        (b: { company_id: number; employee_id: number; project_id: number; contract_id: number }) => Promise<{ id: number }>
  load:        (id: number) => Promise<{ row: Record<string, unknown> & { ID: number; STATUS_ID: number; PROJECT_ID: number | null; CONTRACT_ID: number | null }; project: Ref; contract: Ref }>
  patch:       (id: number, body: AnyBody) => Promise<unknown>
  proposal:    (id: number) => Promise<{ data: BillingProposal }>
  performance: (id: number, amount: number) => Promise<{ data: BillingProposal }>
  tec:         (id: number) => Promise<{ data: TecEntry[]; hasBt2: boolean }>
  assignTec:   (id: number, body: { ids_assign: number[]; ids_unassign: number[] }) => Promise<{ data: BillingProposal }>
  book:        (id: number) => Promise<unknown>
  bookForce:   (id: number) => Promise<unknown>
  remove:      (id: number) => Promise<unknown>
  pdf:         (id: number) => unknown
  einvoice:    (id: number, format: 'ubl' | 'cii') => Promise<void>
}

const abschlag: WizardApi = {
  kind: 'abschlag', noun: 'Abschlagsrechnung',
  dateCol: 'ADVANCE_INVOICE_DATE', dateKey: 'advance_invoice_date', supportsSe: true,
  attachments: 'partial-payments', listKey: 'partial-payments',
  init:        b => initPartialPayment(b),
  load:        async id => {
    const r = await getPartialPayment(id)
    return { row: r.data.pp as unknown as Awaited<ReturnType<WizardApi['load']>>['row'], project: r.data.project, contract: r.data.contract }
  },
  patch:       (id, b) => patchPartialPayment(id, b as Parameters<typeof patchPartialPayment>[1]),
  proposal:    getPpBillingProposal,
  performance: putPpPerformance,
  tec:         getPpTec,
  assignTec:   postPpTec,
  book:        bookPartialPayment,
  bookForce:   bookPartialPaymentForce,
  remove:      deletePartialPayment,
  pdf:         openPpPdf,
  einvoice:    (id, f) => downloadPpEinvoice(id, null, f),
}

function invoiceApi(kind: 'rechnung' | 'gutschrift'): WizardApi {
  return {
    kind, noun: kind === 'gutschrift' ? 'Gutschrift' : 'Rechnung',
    dateCol: 'INVOICE_DATE', dateKey: 'invoice_date', supportsSe: false,
    attachments: 'invoices', listKey: 'invoices',
    init:        b => initInvoice({ ...b, invoice_type: kind }),
    load:        async id => {
      const r = await getInvoice(id)
      return { row: r.data.inv as unknown as Awaited<ReturnType<WizardApi['load']>>['row'], project: r.data.project, contract: r.data.contract }
    },
    patch:       (id, b) => patchInvoice(id, b as Parameters<typeof patchInvoice>[1]),
    proposal:    getInvoiceBillingProposal,
    performance: putInvoicePerformance,
    tec:         getInvoiceTec,
    assignTec:   postInvoiceTec,
    book:        id => bookInvoice(id),
    bookForce:   bookInvoiceForce,
    remove:      deleteInvoice,
    pdf:         id => openInvoicePdf(id),
    einvoice:    (id, f) => downloadInvoiceEinvoice(id, kind, null, f),
  }
}

export function wizardApi(kind: WizardKind): WizardApi {
  return kind === 'abschlag' ? abschlag : invoiceApi(kind)
}
