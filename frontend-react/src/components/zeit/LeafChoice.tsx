import { History } from 'lucide-react'
import { HelpHint } from '@/components/ui/HelpHint'
import { ProjectPicker } from '@/components/projekte/ProjectPicker'
import { lastSegment, type LeafChoice } from '@/components/zeit/useLeafChoice'

/** „Zuletzt gebucht"-Chips, Projekt-Suche und Leistung (nur Blaetter). */
export function LeafFields({
  choice, idPrefix, projectLabel = 'Projekt', leafLabel = 'Leistung', errors = {}, onPicked,
}: {
  choice:        LeafChoice
  idPrefix:      string
  projectLabel?: string
  leafLabel?:    string
  errors?:       { project?: string; leaf?: string }
  onPicked?:     () => void
}) {
  const c = choice
  return (
    <>
      {c.recents.length > 0 && (
        <div className="qb-recents">
          <div className="qb-recents-title">
            <History size={13} strokeWidth={2} aria-hidden="true" /> Zuletzt gebucht
            <HelpHint id="bookings.quick" size={13} />
          </div>
          <div className="qb-chips">
            {c.recents.map(r => {
              const abbr   = c.projectAbbr(r.projectId)
              const active = r.projectId === c.projectId && r.ENTITY_ID === c.structureId
              return (
                <button key={r.ID} type="button" className="qb-chip qb-recent-chip" aria-pressed={active}
                  title={`${abbr} · ${r.LABEL ?? ''}`}
                  onClick={() => { c.pick(r.projectId, r.ENTITY_ID); onPicked?.() }}>
                  <span className="qb-chip-project">{abbr}</span>
                  <span className="qb-chip-leaf">{lastSegment(r.LABEL ?? '')}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="form-group">
        <label>{projectLabel}*</label>
        <ProjectPicker
          projects={c.projects}
          selectedId={c.projectId}
          onSelect={id => { c.setProject(id); onPicked?.() }}
          placeholder="Projekt suchen …"
          openOnFocus={false}
        />
        {errors.project && <p className="form-field-error" role="alert">{errors.project}</p>}
      </div>

      <div className="form-group">
        <label htmlFor={`${idPrefix}-leaf`}>{leafLabel}*</label>
        <select id={`${idPrefix}-leaf`} value={c.structureId ?? ''} disabled={c.projectId == null || c.structLoading}
          aria-invalid={errors.leaf ? true : undefined}
          onChange={e => { c.setLeaf(e.target.value ? Number(e.target.value) : null); onPicked?.() }}>
          <option value="">{c.projectId == null ? 'Erst ein Projekt wählen' : c.structLoading ? 'Lädt …' : 'Bitte wählen …'}</option>
          {c.leaves.map(l => <option key={l.STRUCTURE_ID} value={l.STRUCTURE_ID}>{c.paths.get(l.STRUCTURE_ID) ?? l.ABBR}</option>)}
        </select>
        {errors.leaf && <p className="form-field-error" role="alert">{errors.leaf}</p>}
      </div>
    </>
  )
}
