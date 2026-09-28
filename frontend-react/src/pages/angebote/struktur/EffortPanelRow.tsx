import { HelpHint } from '@/components/ui/HelpHint'
import type { ActiveRole } from '@/api/projekte'
import { EffortLinesEditor } from './EffortLinesEditor'
import type { EffortLineEdit } from './offerStrukturCalc'

/**
 * Aufwands-Panel: eine Tabellenzeile unter einem Element nach Aufwand, wie das
 * Zuschlags-Panel. Die Zeilen gehen in den Puffer der Tabelle und werden mit
 * „Speichern" uebernommen.
 */
export function EffortPanelRow({ colSpan, abbr, lines, roles, readOnly, onChange, onDone }: {
  colSpan:  number
  abbr:     string
  lines:    EffortLineEdit[]
  roles:    ActiveRole[]
  readOnly: boolean
  onChange: (lines: EffortLineEdit[]) => void
  onDone:   () => void
}) {
  return (
    <tr className="surcharge-panel-row">
      <td colSpan={colSpan}>
        <div className="surcharge-panel" role="group" aria-label={`Aufwand ${abbr} nach Rollen`}>
          <div className="surcharge-panel-basis ox-effort-title">
            Aufwand {abbr} nach Rollen <HelpHint id="offers.structure.effort" size={13} />
          </div>
          <EffortLinesEditor lines={lines} roles={roles} readOnly={readOnly} onChange={onChange} idPrefix={`ox-eff-${abbr}`} />
          <div className="surcharge-panel-actions">
            <span className="sx-panel-note">Wird mit „Speichern" übernommen.</span>
            <button type="button" className="btn-secondary" onClick={onDone}>Fertig</button>
          </div>
        </div>
      </td>
    </tr>
  )
}
