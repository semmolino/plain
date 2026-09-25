import { useFilterTabs } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'

export type InvoiceKind = 'abschlag' | 'rechnung' | 'schluss' | 'gutschrift'

/**
 * Die Rechnungsarten mit ihren Rechten und Lizenz-Features — dieselben, die
 * vorher als Tabs der Rechnungsseite gefuehrt waren (RechnungenPage TABS).
 */
export const INVOICE_KINDS: { id: InvoiceKind; label: string; hint: string; permissions: string[]; feature?: string }[] = [
  { id: 'abschlag',   label: 'Abschlagsrechnung',             hint: 'nach Leistungsstand',               permissions: ['invoices.create_partial'], feature: 'invoices.partial' },
  { id: 'rechnung',   label: 'Einzelrechnung',                hint: 'freie Positionen',                  permissions: ['invoices.create_single'] },
  { id: 'schluss',    label: 'Teilschluss-/Schlussrechnung',  hint: 'rechnet Abschläge gegen',           permissions: ['invoices.create_final'], feature: 'invoices.final' },
  { id: 'gutschrift', label: 'Gutschrift',                    hint: 'mindert eine gestellte Rechnung',   permissions: ['invoices.create_credit'], feature: 'invoices.credit' },
]

export function useInvoiceKinds() {
  return useLicenseFilterTabs(useFilterTabs(INVOICE_KINDS))
}

