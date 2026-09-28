import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { fmtEur, money, NO_VALUE } from '@/utils/money'

export interface SummaryAmounts {
  net:         number
  vatPct:      number
  tax:         number
  gross:       number
  /** 0 = kein Sicherheitseinbehalt */
  seAmt:       number
  payable:     number
  /** Schlussrechnung: aufgeloeste Sicherheitseinbehalte, kommen zum Brutto dazu */
  seRelease?:  number
  /** Schritt „Beträge": ohne Nebenkosten und Abzuege, die rechnet erst der naechste Schritt */
  provisional: boolean
}

const deDay = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '')

/**
 * Zusammenfassung neben dem Rechnungsassistenten (UI-Pilot Runde 2).
 *
 * Vorher stand der Betrag nur im letzten Schritt, unter den Eingaben — wer in
 * „Rechnungsdaten" oder „Beträge" war, sah nicht, worüber die Rechnung geht.
 * Ab 1200 px ist das eine feste Spalte rechts; darunter eine Zeile
 * „Brutto … · Details" über dem Formular, die sich aufklappen laesst.
 */
export function InvoiceSummary({ project, contract, date, dueDate, bpStart, bpFinish, amounts, status, provisionalHint = 'Nebenkosten und Abzüge kommen im nächsten Schritt dazu.' }: {
  project:  string
  contract: string
  date:     string
  dueDate:  string
  bpStart:  string
  bpFinish: string
  amounts:  SummaryAmounts | null
  status:   string
  /** Was im Betrag „vorläufig" noch fehlt */
  provisionalHint?: string
}) {
  const [open, setOpen] = useState(false)
  const period = bpStart || bpFinish ? `${deDay(bpStart) || '…'} – ${deDay(bpFinish) || '…'}` : ''

  const details = (
    <dl className="iw-sum-list">
      <div><dt>Projekt</dt><dd>{project || NO_VALUE}</dd></div>
      <div><dt>Vertrag</dt><dd>{contract || NO_VALUE}</dd></div>
      <div><dt>Rechnungsdatum</dt><dd>{deDay(date) || NO_VALUE}{dueDate ? <span className="iw-sum-sub">fällig {deDay(dueDate)}</span> : null}</dd></div>
      {period && <div><dt>Leistungszeitraum</dt><dd>{period}</dd></div>}
      {amounts && (
        <>
          <div className="iw-sum-sep"><dt>{amounts.provisional ? 'Netto (vorläufig)' : 'Netto'}</dt><dd className="iw-sum-num">{money(amounts.net)}</dd></div>
          {amounts.vatPct > 0 && <div><dt>zzgl. {amounts.vatPct}&thinsp;% MwSt.</dt><dd className="iw-sum-num">{money(amounts.tax)}</dd></div>}
          <div className="iw-sum-total"><dt>Brutto</dt><dd className="iw-sum-num">{money(amounts.gross)}</dd></div>
          {amounts.seAmt > 0 && (
            <>
              <div><dt>./. Sicherheitseinbehalt</dt><dd className="iw-sum-num">− {fmtEur(amounts.seAmt)}</dd></div>
              <div className="iw-sum-total"><dt>Sofort fällig</dt><dd className="iw-sum-num">{money(amounts.payable)}</dd></div>
            </>
          )}
          {(amounts.seRelease ?? 0) > 0 && (
            <>
              <div><dt>+ Auflösung Sicherheitseinbehalt</dt><dd className="iw-sum-num">+ {fmtEur(amounts.seRelease)}</dd></div>
              <div className="iw-sum-total"><dt>Zahlungsbetrag</dt><dd className="iw-sum-num">{money(amounts.payable)}</dd></div>
            </>
          )}
        </>
      )}
      <div className="iw-sum-sep"><dt>Status</dt><dd>{status}</dd></div>
    </dl>
  )
  // <p> gehoert nicht in eine <dl> — der Hinweis steht darunter.
  const body = (
    <>
      {details}
      {amounts?.provisional && <p className="iw-sum-hint">{provisionalHint}</p>}
    </>
  )

  return (
    <>
      <div className="iw-sum-line">
        <button type="button" className="iw-sum-toggle" aria-expanded={open} aria-controls="iw-sum-details" onClick={() => setOpen(o => !o)}>
          <span className="iw-sum-head">
            {amounts
              ? <>Brutto <strong>{fmtEur(amounts.gross)}</strong>{amounts.provisional ? ' (vorläufig)' : ''}</>
              : <strong>{project || 'Noch kein Projekt gewählt'}</strong>}
          </span>
          <span className="iw-sum-more">Details <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className={open ? 'iw-sum-chev--open' : undefined} /></span>
        </button>
        {open && <div id="iw-sum-details" className="iw-sum-panel">{body}</div>}
      </div>
      <aside className="iw-sum-col" aria-label="Zusammenfassung">
        <p className="iw-sum-title">Zusammenfassung</p>
        {body}
      </aside>
    </>
  )
}
