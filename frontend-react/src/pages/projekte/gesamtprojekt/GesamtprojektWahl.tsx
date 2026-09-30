import { useQuery } from '@tanstack/react-query'
import { HelpHint } from '@/components/ui/HelpHint'
import { fetchProjectGroups } from '@/api/gesamtprojekte'
import { groupLabel, useDerivedAbbr, type GruppenWahl } from './gesamtprojektUi'

/**
 * „Gesamtprojekt" beim Anlegen und Beauftragen. Wer ein Projekt in ein
 * Gesamtprojekt legt, kann die Nummer davon ableiten lassen
 * (z. B. 2026-014-02) — der Nummernkreis bleibt dann unberührt.
 * Nutzlast über `gruppenPayload` (gesamtprojektUi.ts).
 */
export function GesamtprojektWahl({ value, onChange, idPrefix }: {
  value:    GruppenWahl
  onChange: (next: GruppenWahl) => void
  idPrefix: string
}) {
  const { data } = useQuery({ queryKey: ['project-groups'], queryFn: fetchProjectGroups })
  const groups = data?.data ?? []
  const derivedAbbr = useDerivedAbbr(value.groupId)

  return (
    <div className="pg-wahl">
      <div className="form-group">
        <label htmlFor={`${idPrefix}-group`}>
          Gesamtprojekt <HelpHint id="projects.gesamtprojekt" size={13} />
        </label>
        <select id={`${idPrefix}-group`} value={value.groupId}
          onChange={e => onChange({ groupId: e.target.value, derived: e.target.value ? value.derived : false })}>
          <option value="">— keinem Gesamtprojekt zuordnen —</option>
          {groups.map(g => <option key={g.ID} value={g.ID}>{groupLabel(g)}</option>)}
        </select>
      </div>
      {value.groupId && (
        <fieldset className="pg-fieldset pg-wahl-nummer">
          <legend>Projektnummer</legend>
          <label className="pg-radio">
            <input type="radio" name={`${idPrefix}-abbr`} checked={!value.derived}
              onChange={() => onChange({ ...value, derived: false })} />
            Nächste Nummer aus dem Nummernkreis
          </label>
          <label className="pg-radio">
            <input type="radio" name={`${idPrefix}-abbr`} checked={value.derived} disabled={!derivedAbbr}
              onChange={() => onChange({ ...value, derived: true })} />
            {derivedAbbr ? <>Abgeleitet: <strong>{derivedAbbr}</strong></> : 'Abgeleitet — das Gesamtprojekt hat kein Kürzel'}
          </label>
        </fieldset>
      )}
    </div>
  )
}
