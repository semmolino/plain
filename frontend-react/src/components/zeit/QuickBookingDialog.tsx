import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { Disclosure } from '@/components/ui/Disclosure'
import { HelpHint } from '@/components/ui/HelpHint'
import { TextSnippetBar } from '@/components/ui/TextSnippetBar'
import { ProjectPicker } from '@/components/projekte/ProjectPicker'
import {
  fetchProjectsShort, fetchProjectStructure, fetchActiveEmployees, fetchEmployee2ProjectPreset, createBuchung,
} from '@/api/projekte'
import { fetchRecents, trackRecent } from '@/api/recents'
import { parentStructureIds, structurePaths } from '@/utils/treeUtils'
import { localIsoDate, addDaysIso, previousWorkday, hoursBetween, parseHours, fmtHours } from '@/utils/zeit'
import { useQuickBooking, type QuickBookingPrefill } from '@/store/quickBookingStore'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { useIsNarrow } from '@/hooks/useIsNarrow'

const DURATION_CHIPS = [0.5, 1, 2, 4, 8]

/**
 * „Zeit buchen" — ein Dialog fuer Stundenbuchungen, erreichbar von ueberall
 * (UI-Pilot 2026-09).
 *
 * Vorher ging eine Stundenbuchung nur ueber Projekte → Reiter Buchungen →
 * Projekt waehlen → „+ Stundenbuchung" → neun Felder, darunter ein
 * Pflicht-Stundensatz, der bei fehlendem Recht ausgeblendet und damit
 * unerfuellbar war. Die Stunden wurden nicht aus Von/Bis berechnet, und
 * „Speichern" stand links neben „Abbrechen".
 *
 * Jetzt: „Zuletzt gebucht" setzt Projekt und Leistung mit einem Tipp, Datum
 * und Dauer gehen ueber Chips, Von/Bis rechnet die Dauer aus. Was selten
 * gebraucht wird (abweichende Abrechnungsstunden, Stundensatz, anderer
 * Mitarbeiter), liegt hinter „Weitere Angaben". Kosten- und Stundensatz
 * setzt der Server ohnehin selbst (Kostensatz-Verlauf, Preisliste).
 */
export function QuickBookingDialog() {
  const { isOpen, prefill, close } = useQuickBooking()
  if (!isOpen) return null
  return <QuickBookingForm key={JSON.stringify(prefill)} prefill={prefill} onClose={close} />
}

function QuickBookingForm({ prefill, onClose }: { prefill: QuickBookingPrefill; onClose: () => void }) {
  const qc     = useQueryClient()
  const toast  = useToast()
  const narrow = useIsNarrow()
  const ownId  = useAuthStore(s => s.employeeId)
  const showRevenue = usePermission('projects.bookings.revenue.view')
  const today  = localIsoDate()
  const lastWorkday = previousWorkday(today)

  const [projectId,   setProjectId]   = useState<number | null>(prefill.projectId ?? null)
  // undefined = noch nicht gewaehlt → Vorbelegung gilt; null = bewusst geleert.
  const [structureChoice, setStructureId] = useState<number | null | undefined>(prefill.structureId)
  const [date,        setDate]        = useState(prefill.date ?? today)
  const [timeStart,   setTimeStart]   = useState('')
  const [timeFinish,  setTimeFinish]  = useState('')
  const [hours,       setHours]       = useState('')
  const [description, setDescription] = useState('')
  const [ext,         setExt]         = useState('')
  const [rate,        setRate]        = useState('')
  const [employeeId,  setEmployeeId]  = useState<number | null>(ownId)
  const [errors,      setErrors]      = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: structData, isLoading: structLoading } = useQuery({
    queryKey: ['structure', projectId],
    queryFn:  () => fetchProjectStructure(projectId!),
    enabled:  projectId != null,
  })
  const { data: recentsData } = useQuery({
    queryKey: ['recents', 'project_structure', null, 'recent'],
    queryFn:  () => fetchRecents('project_structure', 12, { sortBy: 'recent' }),
    staleTime: 30_000,
  })
  const { data: empData } = useQuery({
    queryKey: ['active-employees'], queryFn: fetchActiveEmployees, enabled: !!prefill.allowOtherEmployee,
  })
  const { data: preset } = useQuery({
    queryKey: ['e2p-preset', employeeId, projectId],
    queryFn:  () => fetchEmployee2ProjectPreset(employeeId!, projectId!),
    enabled:  employeeId != null && projectId != null,
  })

  const projects  = useMemo(() => projectsData?.data ?? [], [projectsData])
  const structure = useMemo(() => structData?.data ?? [], [structData])
  const paths     = useMemo(() => structurePaths(structure), [structure])
  const leaves    = useMemo(() => {
    const parents = parentStructureIds(structure)
    return structure
      .filter(n => !parents.has(n.STRUCTURE_ID))
      .sort((a, b) => (paths.get(a.STRUCTURE_ID) ?? '').localeCompare(paths.get(b.STRUCTURE_ID) ?? '', 'de', { numeric: true }))
  }, [structure, paths])

  // Zuletzt gebucht — ueber alle Projekte, je Leistung einmal.
  const recents = useMemo(() => {
    const seen = new Set<number>()
    return (recentsData?.data ?? []).filter(r => {
      const pid = Number((r.META as { project_id?: number } | null)?.project_id)
      if (!Number.isFinite(pid) || seen.has(r.ENTITY_ID)) return false
      seen.add(r.ENTITY_ID)
      return projects.some(p => p.ID === pid)
    }).slice(0, narrow ? 3 : 6)
  }, [recentsData, projects, narrow])

  // Leistung vorbelegen: die einzige Leistung oder die zuletzt in diesem
  // Projekt gebuchte. Abgeleitet statt per Effekt gesetzt — eine Wahl des
  // Nutzers (auch „bitte waehlen") hat immer Vorrang.
  const defaultLeaf = useMemo(() => {
    if (projectId == null || !leaves.length) return null
    if (leaves.length === 1) return leaves[0].STRUCTURE_ID
    const last = (recentsData?.data ?? []).find(r =>
      Number((r.META as { project_id?: number } | null)?.project_id) === projectId && leaves.some(l => l.STRUCTURE_ID === r.ENTITY_ID))
    return last ? last.ENTITY_ID : null
  }, [projectId, leaves, recentsData])
  const structureId = structureChoice === undefined ? defaultLeaf : structureChoice

  // Stundensatz aus der Preisliste des Projekts
  const presetRate = preset?.found && preset.HOURLY_RATE != null ? preset.HOURLY_RATE : null

  function setTimes(start: string, finish: string) {
    setTimeStart(start); setTimeFinish(finish)
    const h = hoursBetween(start, finish)
    if (h != null) setHours(fmtHours(h))
  }

  const hoursNum  = parseHours(hours)
  const timesBad  = !!timeStart && !!timeFinish && hoursBetween(timeStart, timeFinish) == null
  const project   = projects.find(p => p.ID === projectId)
  const leafLabel = (id: number | null) => {
    if (id == null) return ''
    const p = paths.get(id) ?? ''
    return p.includes(' > ') ? p.slice(p.lastIndexOf(' > ') + 3) : p
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (projectId == null)                       e.project = 'Wähle ein Projekt.'
    if (structureId == null)                     e.leaf    = 'Wähle eine Leistung.'
    if (!date)                                   e.date    = 'Gib ein Datum an.'
    if (timesBad)                                e.times   = '„Bis" liegt vor „Von".'
    if (hoursNum == null || hoursNum <= 0)       e.hours   = 'Gib eine Dauer größer 0 an.'
    if (!description.trim())                     e.desc    = 'Beschreibe kurz, was du gemacht hast.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(mode: 'close' | 'again') {
    setServerError(null)
    if (!validate() || projectId == null || structureId == null || hoursNum == null) return
    const extNum = showRevenue && ext !== '' ? parseHours(ext) : null
    setSaving(true)
    try {
      await createBuchung({
        PROJECT_ID:          projectId,
        STRUCTURE_ID:        structureId,
        EMPLOYEE_ID:         employeeId ?? ownId ?? 0,
        BOOKING_DATE:        date,
        TIME_START:          timeStart  || undefined,
        TIME_FINISH:         timeFinish || undefined,
        QUANTITY_INT:        hoursNum,
        QUANTITY_EXT:        extNum ?? hoursNum,
        // Pflichtfeld am Server; die Preisliste des Projekts hat dort Vorrang.
        HOURLY_RATE:         presetRate ?? (showRevenue && rate !== '' ? parseHours(rate) ?? 0 : 0),
        POSTING_DESCRIPTION: description.trim(),
      })
    } catch (e) {
      setServerError((e as Error)?.message || 'Buchen fehlgeschlagen')
      setSaving(false)
      return
    }
    setSaving(false)
    const path = paths.get(structureId) ?? leafLabel(structureId)
    void trackRecent('project_structure', structureId, path, { project_id: projectId }).catch(() => {})
    for (const key of ['buchungen', 'timer-drafts', 'emp-balance', 'emp-running', 'workstart-status', 'recents', 'my-streak']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
    void qc.invalidateQueries({ queryKey: ['structure', projectId] })
    toast.success(`${fmtHours(hoursNum)} h gebucht · ${project?.ABBR ?? ''} / ${leafLabel(structureId)}`)
    if (mode === 'close') { onClose(); return }
    setTimeStart(''); setTimeFinish(''); setHours(''); setDescription(''); setExt(''); setErrors({})
  }

  const dateChips = [
    { label: 'Heute', value: today },
    { label: lastWorkday === addDaysIso(today, -1) ? 'Gestern' : 'Freitag', value: lastWorkday },
  ]

  const timesFields = (
    <div className="qb-times">
      <div className="form-group">
        <label htmlFor="qb-von">Von</label>
        <input id="qb-von" type="time" value={timeStart} onChange={e => setTimes(e.target.value, timeFinish)} />
      </div>
      <div className="form-group">
        <label htmlFor="qb-bis">Bis</label>
        <input id="qb-bis" type="time" value={timeFinish} onChange={e => setTimes(timeStart, e.target.value)}
          aria-invalid={errors.times ? true : undefined} />
      </div>
    </div>
  )

  return (
    <Modal open onClose={onClose} title="Zeit buchen" className="qb-dialog">
      <form
        className="qb-form"
        onSubmit={e => { e.preventDefault(); void submit('close') }}
        onKeyDown={e => {
          // Strg+S hier abfangen und nicht weiterreichen — sonst speichert
          // die Seite dahinter (useCtrlS am window) gleich mit.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault(); e.stopPropagation(); void submit('close')
          }
        }}
        noValidate
      >
        {recents.length > 0 && (
          <div className="qb-recents">
            <div className="qb-recents-title">
              <History size={13} strokeWidth={2} aria-hidden="true" /> Zuletzt gebucht
              <HelpHint id="bookings.quick" size={13} />
            </div>
            <div className="qb-chips">
              {recents.map(r => {
                const pid = Number((r.META as { project_id?: number }).project_id)
                const abbr = projects.find(p => p.ID === pid)?.ABBR ?? ''
                const lbl = (r.LABEL ?? '').includes(' > ') ? (r.LABEL ?? '').slice((r.LABEL ?? '').lastIndexOf(' > ') + 3) : (r.LABEL ?? '')
                const active = pid === projectId && r.ENTITY_ID === structureId
                return (
                  <button key={r.ID} type="button" className="qb-chip qb-recent-chip" aria-pressed={active}
                    title={`${abbr} · ${r.LABEL ?? ''}`}
                    onClick={() => { setProjectId(pid); setStructureId(r.ENTITY_ID); setErrors({}) }}>
                    <span className="qb-chip-project">{abbr}</span>
                    <span className="qb-chip-leaf">{lbl}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Projekt*</label>
          <ProjectPicker
            projects={projects}
            selectedId={projectId}
            onSelect={id => { setProjectId(id); setStructureId(undefined) }}
            placeholder="Projekt suchen …"
            openOnFocus={false}
          />
          {errors.project && <p className="form-field-error" role="alert">{errors.project}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="qb-leaf">Leistung*</label>
          <select id="qb-leaf" value={structureId ?? ''} disabled={projectId == null || structLoading}
            aria-invalid={errors.leaf ? true : undefined}
            onChange={e => setStructureId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{projectId == null ? 'Erst ein Projekt wählen' : structLoading ? 'Lädt …' : 'Bitte wählen …'}</option>
            {leaves.map(l => <option key={l.STRUCTURE_ID} value={l.STRUCTURE_ID}>{paths.get(l.STRUCTURE_ID) ?? l.ABBR}</option>)}
          </select>
          {errors.leaf && <p className="form-field-error" role="alert">{errors.leaf}</p>}
        </div>

        <div className="qb-row">
          <div className="form-group qb-date">
            <label htmlFor="qb-date">Datum*</label>
            <div className="qb-inline">
              {dateChips.map(c => (
                <button key={c.label} type="button" className="qb-chip" aria-pressed={date === c.value} onClick={() => setDate(c.value)}>
                  {c.label}
                </button>
              ))}
              <input id="qb-date" type="date" value={date} max={addDaysIso(today, 31)} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
        </div>

        {!narrow && timesFields}
        {narrow && (
          <Disclosure title="Uhrzeit angeben" hint={timeStart && timeFinish ? `${timeStart}–${timeFinish}` : 'optional'} defaultOpen={!!(timeStart || timeFinish)}>
            {timesFields}
          </Disclosure>
        )}
        {errors.times && <p className="form-field-error" role="alert">{errors.times}</p>}

        <div className="form-group">
          <label htmlFor="qb-hours">Dauer (Stunden)*</label>
          <div className="qb-inline">
            <input id="qb-hours" className="qb-hours" type="text" inputMode="decimal" placeholder="z. B. 1,5"
              value={hours} aria-invalid={errors.hours ? true : undefined}
              onChange={e => setHours(e.target.value)} />
            {DURATION_CHIPS.map(h => (
              <button key={h} type="button" className="qb-chip" aria-pressed={hoursNum === h}
                onClick={() => { setHours(fmtHours(h)); setTimeStart(''); setTimeFinish('') }}>
                {fmtHours(h)} h
              </button>
            ))}
          </div>
          {errors.hours && <p className="form-field-error" role="alert">{errors.hours}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="qb-desc">Beschreibung*</label>
          <textarea id="qb-desc" rows={2} value={description} aria-invalid={errors.desc ? true : undefined}
            placeholder="Was hast du gemacht?"
            onChange={e => setDescription(e.target.value)} />
          <TextSnippetBar currentText={description} onChange={setDescription} kind="WORK" />
          {errors.desc && <p className="form-field-error" role="alert">{errors.desc}</p>}
        </div>

        {(showRevenue || prefill.allowOtherEmployee) && (
          <Disclosure title="Weitere Angaben" className="qb-more"
            hint={ext !== '' || (rate !== '' && presetRate == null) || (employeeId !== ownId) ? 'geändert' : undefined}>
            {prefill.allowOtherEmployee && (
              <div className="form-group">
                <label htmlFor="qb-emp">Mitarbeiter</label>
                <select id="qb-emp" value={employeeId ?? ''} onChange={e => setEmployeeId(e.target.value ? Number(e.target.value) : null)}>
                  {(empData?.data ?? []).map(e => <option key={e.ID} value={e.ID}>{e.ABBR}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
                </select>
              </div>
            )}
            {showRevenue && (
              <div className="qb-times">
                <div className="form-group">
                  <label htmlFor="qb-ext">Zur Abrechnung (h)</label>
                  <input id="qb-ext" type="text" inputMode="decimal" placeholder={hours || 'wie Dauer'}
                    value={ext} onChange={e => setExt(e.target.value)} />
                  <p className="form-field-hint">Leer = wie Dauer. Weniger bei Kulanz.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="qb-rate">Stundensatz (€)</label>
                  <input id="qb-rate" type="text" inputMode="decimal"
                    value={presetRate != null ? fmtHours(presetRate) : rate}
                    readOnly={presetRate != null}
                    onChange={e => setRate(e.target.value)} />
                  <p className="form-field-hint">{presetRate != null ? `Aus der Preisliste des Projekts${preset?.ROLE_ABBR ? ` (${preset.ROLE_ABBR})` : ''}.` : 'Kein Satz in der Preisliste hinterlegt.'}</p>
                </div>
              </div>
            )}
          </Disclosure>
        )}

        <Message text={serverError} type="error" />

        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-secondary qb-again" onClick={() => void submit('again')} disabled={saving}>Buchen &amp; weitere</button>
          <button type="button" className="btn-primary" onClick={() => void submit('close')} disabled={saving}>
            {saving ? 'Bucht …' : 'Buchen'}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  )
}
