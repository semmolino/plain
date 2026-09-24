import { ChevronDown, Plus } from 'lucide-react'
import { RowMenu } from '@/components/ui/RowMenu'
import { useInvoiceKinds, type InvoiceKind } from './invoiceKinds'

/**
 * „+ Neue Rechnung ▾" (UI-Pilot 2026-09).
 *
 * Vorher legte man Rechnungen an, indem man auf der Rechnungsseite einen von
 * vier Tabs waehlte — die Liste selbst hatte keinen Knopf dafuer, und wer
 * sie suchte, fand „Abschlagsrechnungen" zwischen „Mahnungen" und
 * „Sicherheitseinbehalte". Jetzt ist Anlegen eine Aktion, keine Ansicht.
 *
 * Ist nur eine Art erlaubt, oeffnet der Knopf sie direkt statt eines Menues
 * mit einem Eintrag.
 */
export function NewInvoiceMenu({ onPick, primary = false, label = 'Neue Rechnung' }: {
  onPick: (kind: InvoiceKind) => void
  /** Als Hauptaktion (gefuellt) statt sekundaer. */
  primary?: boolean
  label?: string
}) {
  const kinds = useInvoiceKinds()
  const cls = primary ? 'btn-primary' : 'btn-secondary'
  if (kinds.length === 0) return null
  if (kinds.length === 1) {
    return (
      <button type="button" className={cls} onClick={() => onPick(kinds[0].id)}>
        <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> {kinds[0].label}
      </button>
    )
  }
  return (
    <RowMenu
      label={label}
      triggerClassName={cls}
      triggerContent={<><Plus size={15} strokeWidth={2.25} aria-hidden="true" />{label}<ChevronDown size={14} strokeWidth={2} aria-hidden="true" /></>}
    >
      {kinds.map(k => (
        <button key={k.id} type="button" role="menuitem" className="row-menu-item invoice-kind-item" onClick={() => onPick(k.id)}>
          <span className="invoice-kind-label">{k.label}</span>
          <span className="invoice-kind-hint">{k.hint}</span>
        </button>
      ))}
    </RowMenu>
  )
}
