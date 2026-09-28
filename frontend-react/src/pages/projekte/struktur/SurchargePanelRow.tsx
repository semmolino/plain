import { computeSurcharges, type SurchargeEdit } from './strukturCalc'
import { fmtEur, money } from '@/utils/money'

/**
 * Zuschlags-Panel: eine Tabellenzeile unter dem Element (Projekt- und
 * Angebotsstruktur). Die Eingaben gehen in den Puffer der Tabelle und werden
 * mit „Speichern" uebernommen — nicht mehr beim Schliessen, wie bis Runde 1
 * („Schließen (speichert automatisch)").
 */
export function SurchargePanelRow({ colSpan, title, basis, edit, computed, onChange, onDone, readOnly }: {
  colSpan:  number
  title:    string
  basis:    number
  edit:     SurchargeEdit
  computed: ReturnType<typeof computeSurcharges>
  onChange: (f: Partial<SurchargeEdit>) => void
  onDone:   () => void
  readOnly: boolean
}) {
  const rows = [
    { label: edit.s1Label, pct: edit.s1Pct, cumul: edit.s1Cumul, eur: computed.s1Eur, disableCumul: true,  placeholder: 'z. B. Umbauzuschlag', labelKey: 's1Label' as const, pctKey: 's1Pct' as const, cumulKey: 's1Cumul' as const },
    { label: edit.s2Label, pct: edit.s2Pct, cumul: edit.s2Cumul, eur: computed.s2Eur, disableCumul: false, placeholder: '(leer = inaktiv)',    labelKey: 's2Label' as const, pctKey: 's2Pct' as const, cumulKey: 's2Cumul' as const },
    { label: edit.s3Label, pct: edit.s3Pct, cumul: edit.s3Cumul, eur: computed.s3Eur, disableCumul: false, placeholder: '(leer = inaktiv)',    labelKey: 's3Label' as const, pctKey: 's3Pct' as const, cumulKey: 's3Cumul' as const },
  ]
  return (
    <tr className="surcharge-panel-row">
      <td colSpan={colSpan}>
        <div className="surcharge-panel">
          <div className="surcharge-panel-basis">
            {title}: <strong>{money(basis)}</strong>
          </div>
          <div className="surcharge-grid">
            <div className="surcharge-grid-header">
              <span>Kumul.</span>
              <span>Bezeichnung</span>
              <span style={{ textAlign: 'right' }}>%</span>
              <span style={{ textAlign: 'right' }}>Betrag</span>
            </div>
            {rows.map((row, i) => (
              <div className="surcharge-grid-row" key={i}>
                <input type="checkbox" checked={row.cumul} disabled={row.disableCumul || readOnly}
                  aria-label={`Zuschlag ${i + 1} kumulativ`}
                  title={row.disableCumul ? 'Erster Zuschlag bezieht sich immer auf die Basis' : 'Kumulativ (auf laufende Zwischensumme)'}
                  onChange={e => onChange({ [row.cumulKey]: e.target.checked })} />
                <input className="tbl-input" placeholder={row.placeholder} value={row.label} disabled={readOnly}
                  aria-label={`Zuschlag ${i + 1} Bezeichnung`}
                  onChange={e => onChange({ [row.labelKey]: e.target.value })} />
                <input className="tbl-input" type="text" inputMode="decimal" disabled={readOnly}
                  aria-label={`Zuschlag ${i + 1} Prozent`}
                  style={{ width: 64, textAlign: 'right' }} value={row.pct}
                  onChange={e => onChange({ [row.pctKey]: e.target.value.replace(',', '.') })} />
                <span className="surcharge-eur">{row.label || row.pct ? fmtEur(row.eur) : '—'}</span>
              </div>
            ))}
            <div className="surcharge-grid-total">
              Gesamt Zuschläge: <strong>{money(computed.total)}</strong>
            </div>
          </div>
          <div className="surcharge-panel-actions">
            <span className="sx-panel-note">Wird mit „Speichern" übernommen.</span>
            <button type="button" className="btn-secondary" onClick={onDone}>Fertig</button>
          </div>
        </div>
      </td>
    </tr>
  )
}
