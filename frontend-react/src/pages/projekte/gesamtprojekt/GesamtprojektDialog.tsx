import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast } from '@/store/toastStore'
import { searchAddressesApi } from '@/api/stammdaten'
import { fetchProjectListFull, fetchProjectManagers } from '@/api/projekte'
import { createProjectGroup, fetchProjectGroups, type ProjectGroupDetail } from '@/api/gesamtprojekte'
import { ProjektAuswahl } from './ProjektAuswahl'
import { movedNote, useInvalidateGroups } from './gesamtprojektUi'

/** Vorbelegung, wenn der Dialog aus einem Projekt heraus geöffnet wird. */
export interface GesamtprojektPreset {
  name:        string
  abbr:        string
  addressId:   number | null
  addressName: string
  managerId:   number | null
}

interface Form {
  name:      string
  abbr:      string
  addressId: number | null
  addrText:  string
  managerId: string
  notes:     string
}

/**
 * Neues Gesamtprojekt.
 *
 * Gleicher Name: Die Datenbank verbietet keine Dubletten (eine UNIQUE-Regel
 * kennt keine Mandanten, siehe CLAUDE.md zu Migration 0164) — die Prüfung
 * steht deshalb hier, wo sie fragen kann statt abzuweisen.
 *
 * `withProjects`: aus der Liste der Gesamtprojekte heraus gleich Projekte
 * wählen. Aus den Projektdaten heraus nicht — dort ordnet das Formular das
 * eigene Projekt erst beim Speichern zu, wie jedes andere Feld auch.
 */
export function GesamtprojektDialog({ open, onClose, onCreated, preset, withProjects = false }: {
  open:          boolean
  onClose:       () => void
  onCreated:     (group: ProjectGroupDetail) => void
  preset?:       GesamtprojektPreset
  withProjects?: boolean
}) {
  if (!open) return null
  return <DialogInner onClose={onClose} onCreated={onCreated} preset={preset} withProjects={withProjects} />
}

function DialogInner({ onClose, onCreated, preset, withProjects }: {
  onClose:      () => void
  onCreated:    (group: ProjectGroupDetail) => void
  preset?:      GesamtprojektPreset
  withProjects: boolean
}) {
  const toast = useToast()
  const invalidate = useInvalidateGroups()
  const [confirm, confirmDialog] = useConfirm()
  const [initial] = useState<Form>(() => ({
    name:      preset?.name ?? '',
    abbr:      preset?.abbr ?? '',
    addressId: preset?.addressId ?? null,
    addrText:  preset?.addressName ?? '',
    managerId: preset?.managerId != null ? String(preset.managerId) : '',
    notes:     '',
  }))
  const [f, setF] = useState<Form>(initial)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState(false)

  const { data: groupsData }   = useQuery({ queryKey: ['project-groups'], queryFn: fetchProjectGroups })
  const { data: mgrData }      = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })
  const { data: projectsData } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull, enabled: withProjects })

  const dirty = JSON.stringify(f) !== JSON.stringify(initial) || selected.size > 0
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF(x => ({ ...x, [k]: v })); setErr(null) }

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function requestClose() {
    if (pending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: 'Das Gesamtprojekt wird nicht angelegt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  async function save() {
    if (pending) return
    setTried(true)
    const name = f.name.trim()
    if (!name) { setErr('Bitte einen Namen angeben.'); return }

    const same = (groupsData?.data ?? []).filter(g => g.NAME.trim().toLowerCase() === name.toLowerCase())
    if (same.length) {
      const ok = await confirm({
        title: 'Dieses Gesamtprojekt gibt es schon',
        message: `„${same[0].NAME}" steht bereits in der Liste${same.length > 1 ? ` (${same.length}-mal)` : ''}. Trotzdem ein weiteres anlegen?`,
        confirmLabel: 'Trotzdem anlegen',
        confirmClass: 'btn-primary',
      })
      if (!ok) return
    }

    setPending(true)
    setErr(null)
    try {
      const res = await createProjectGroup({
        name,
        abbr:        f.abbr.trim() || null,
        address_id:  f.addressId,
        manager_id:  f.managerId ? Number(f.managerId) : null,
        notes:       f.notes.trim() || null,
        ...(withProjects && selected.size ? { project_ids: [...selected] } : {}),
      })
      await invalidate()
      toast.success(`Gesamtprojekt „${name}" angelegt.`)
      const note = movedNote(res.moved)
      if (note) toast.info(note)
      onCreated(res.data)
    } catch (e) {
      setErr((e as Error)?.message || 'Anlegen fehlgeschlagen')
    } finally {
      setPending(false)
    }
  }

  useCtrlS(() => void save(), true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title="Neues Gesamtprojekt" className={withProjects ? 'modal-wide' : undefined}>
        <div className="pg-dialog-body">
          <p className="form-field-hint">
            Fasst Projekte zusammen, die zu einem Vorhaben gehören — Verträge und Rechnungen bleiben bei den Projekten.
            <HelpHint id="projects.gesamtprojekt" size={13} />
          </p>
          <div className="form-group">
            <label htmlFor="gpd-name">Name*</label>
            <input id="gpd-name" type="text" value={f.name} autoFocus maxLength={200}
              aria-invalid={(tried && !f.name.trim()) || undefined}
              onChange={e => set('name', e.target.value)} placeholder="z. B. Schule Nord" />
          </div>
          <div className="form-group">
            <label htmlFor="gpd-abbr">Kürzel</label>
            <input id="gpd-abbr" type="text" value={f.abbr} maxLength={60} aria-describedby="gpd-abbr-hint"
              onChange={e => set('abbr', e.target.value)} />
            <p id="gpd-abbr-hint" className="form-field-hint">Frei wählbar, etwa die Nummer des ersten Projekts.</p>
          </div>
          <Autocomplete
            label="Auftraggeber"
            htmlId="gpd-address"
            value={f.addrText}
            onChange={text => { if (text) set('addrText', text); else setF(x => ({ ...x, addrText: '', addressId: null })) }}
            onSelect={(id, label) => setF(x => ({ ...x, addressId: Number(id), addrText: label }))}
            search={searchAddresses}
            placeholder="Adresse suchen …"
          />
          <div className="form-group">
            <label htmlFor="gpd-manager">Gesamtverantwortung</label>
            <select id="gpd-manager" value={f.managerId} onChange={e => set('managerId', e.target.value)}>
              <option value="">— niemand festgelegt —</option>
              {(mgrData?.data ?? []).map(m => <option key={m.ID} value={m.ID}>{m.ABBR}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="gpd-notes">Notizen</label>
            <textarea id="gpd-notes" rows={3} value={f.notes} maxLength={4000}
              onChange={e => set('notes', e.target.value)} />
          </div>
          {withProjects && (
            <fieldset className="pg-fieldset">
              <legend>Projekte</legend>
              <ProjektAuswahl projects={projectsData?.data ?? []} selected={selected} onChange={setSelected}
                currentGroupId={null} idPrefix="gpd-projects" />
            </fieldset>
          )}
          <Message type="error" text={err} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()} disabled={pending}>Abbrechen</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Legt an …' : 'Anlegen'}
            </button>
          </DialogFooter>
        </div>
      </Modal>
      {confirmDialog}
    </>
  )
}
