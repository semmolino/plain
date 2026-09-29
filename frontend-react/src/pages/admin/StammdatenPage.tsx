import { useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import {
  fetchDepartments, createDepartment, updateDepartment, deleteDepartment,
  fetchTypen, createTyp, updateTyp, deleteTyp,
  type StammdatenItem,
} from '@/api/stammdaten'
import { SegmentNav } from '@/pages/mitarbeiter/SegmentNav'
import { ProjektrollenEditor } from './ProjektrollenEditor'
import { BuchungsartenSection } from './BuchungsartenSection'
import { BuchungstextvorlagenSection } from './BuchungstextvorlagenSection'
import { AbwesenheitsartenSection } from './AbwesenheitsartenSection'
import { LeistungsphasenBloeckeSection } from './LeistungsphasenBloeckeSection'
import { ArbeitszeitmodelleSection } from './ArbeitszeitmodelleSection'

/**
 * Einstellungen → Stammdaten (UI-Pilot Runde 12).
 *
 * Vorher eine Seite mit acht Katalogen untereinander — Abteilungen,
 * Projekttypen, Rollen, Buchungsarten, Textvorlagen, Abwesenheitsarten,
 * Leistungsphasen-Blöcke, Arbeitszeitmodelle —, getrennt durch Linien. Wer
 * Arbeitszeitmodelle suchte, scrollte an sieben anderen vorbei. Löschen ging
 * bei Abteilungen, Typen, Rollen und Modellen ohne Rückfrage, per „×", das
 * ein Screenreader als „Mal" vorlas.
 *
 * Jetzt je Katalog ein Unterreiter; der steht in der URL
 * (`?tab=stammdaten&sub=…`), damit ein Link genau dorthin führt und Zurück
 * dorthin zurückkehrt.
 */

const SUBS = [
  { id: 'abteilungen',        label: 'Abteilungen' },
  { id: 'projekttypen',       label: 'Projekttypen' },
  { id: 'projektrollen',      label: 'Projektrollen' },
  { id: 'buchungsarten',      label: 'Buchungsarten' },
  { id: 'textvorlagen',       label: 'Textvorlagen' },
  { id: 'abwesenheitsarten',  label: 'Abwesenheitsarten' },
  { id: 'leistungsphasen',    label: 'Leistungsphasen' },
  { id: 'arbeitszeitmodelle', label: 'Arbeitszeitmodelle' },
] as const
type Sub = typeof SUBS[number]['id']

export function StammdatenPage() {
  const [params, setParams] = useSearchParams()
  const guarded = useGuardedAction()
  const narrow = useIsNarrow()
  const raw = params.get('sub')
  const sub: Sub = SUBS.some(s => s.id === raw) ? raw as Sub : 'abteilungen'

  function changeSub(next: Sub) {
    guarded(() => {
      const p = new URLSearchParams(params)
      p.set('tab', 'stammdaten')
      p.set('sub', next)
      setParams(p, { replace: true })
    })
  }

  return (
    <div className="st-page">
      {/* Acht Kataloge als Umschalter brauchten am Handy vier Zeilen — dort eine Auswahl */}
      {narrow ? (
        <div className="st-sub-select">
          <label htmlFor="st-sub">Bereich</label>
          <select id="st-sub" value={sub} onChange={e => changeSub(e.target.value as Sub)}>
            {SUBS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      ) : (
        <SegmentNav items={SUBS.map(s => ({ id: s.id, label: s.label }))} active={sub} onChange={changeSub} />
      )}
      <div className="st-body">
        {sub === 'abteilungen'        && <AbteilungenEditor />}
        {sub === 'projekttypen'       && <ProjekttypenEditor />}
        {sub === 'projektrollen'      && <ProjektrollenEditor />}
        {sub === 'buchungsarten'      && <div className="admin-section st-legacy"><BuchungsartenSection /></div>}
        {sub === 'textvorlagen'       && <div className="admin-section st-legacy"><BuchungstextvorlagenSection /></div>}
        {sub === 'abwesenheitsarten'  && <AbwesenheitsartenSection />}
        {sub === 'leistungsphasen'    && <div className="st-legacy"><LeistungsphasenBloeckeSection /></div>}
        {sub === 'arbeitszeitmodelle' && <ArbeitszeitmodelleSection />}
      </div>
    </div>
  )
}

function AbteilungenEditor() {
  return (
    <NamedListEditor
      title="Abteilungen" noun="Abteilung" queryKey="departments"
      hint="Ordnen Mitarbeiter:innen und Projekte einem Bereich des Büros zu — für Filter und Auswertungen."
      emptyText="Noch keine Abteilungen. Legen Sie z. B. „Hochbau“ oder „Tragwerksplanung“ an, um Projekte und Mitarbeiter:innen danach zu filtern."
      fetch={fetchDepartments} create={createDepartment} update={updateDepartment} remove={deleteDepartment}
    />
  )
}

function ProjekttypenEditor() {
  return (
    <NamedListEditor
      title="Projekttypen" noun="Projekttyp" queryKey="typen"
      hint="Art des Projekts, z. B. Neubau oder Sanierung — für Filter und Auswertungen."
      emptyText="Noch keine Projekttypen. Legen Sie z. B. „Neubau“ oder „Sanierung“ an, um Projekte danach auszuwerten."
      fetch={fetchTypen} create={createTyp} update={updateTyp} remove={deleteTyp}
    />
  )
}

/**
 * Liste mit einem Namen je Eintrag (Abteilungen, Projekttypen).
 *
 * Vorher Schildchen mit „✎" und „×" in 11 und 14 px — zu klein für den
 * Daumen, ohne Rückfrage beim Löschen und ohne Namen für Screenreader. Ob
 * ein Eintrag noch verwendet wird, prüft der Server (409); seine Antwort
 * sagt, wo, und bleibt stehen, bis man weitermacht.
 */
function NamedListEditor({ title, noun, queryKey, hint, emptyText, fetch, create, update, remove }: {
  title: string; noun: string; queryKey: string; hint: string; emptyText: string
  fetch:  () => Promise<{ data: StammdatenItem[] }>
  create: (name: string) => Promise<unknown>
  update: (id: number, name: string) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const canEdit = usePermission('settings.basedata.edit')
  const [confirm, confirmDialog] = useConfirm()
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const inputId = useId()

  const { data, isLoading, isError } = useQuery({ queryKey: [queryKey], queryFn: fetch })
  const rows = [...(data?.data ?? [])].sort((a, b) => a.ABBR.localeCompare(b.ABBR, 'de'))
  const refresh = () => qc.invalidateQueries({ queryKey: [queryKey] })

  const taken = (name: string, except?: number) =>
    rows.some(r => r.ID !== except && r.ABBR.trim().toLocaleLowerCase('de') === name.trim().toLocaleLowerCase('de'))

  const createMut = useMutation({
    mutationFn: (name: string) => create(name),
    onSuccess: async (_r, name) => { await refresh(); setNewName(''); toast.success(`${noun} „${name}“ angelegt.`) },
    onError: (e: Error) => setErr(e.message),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => update(id, name),
    onSuccess: async () => { await refresh(); setEditId(null) },
    onError: (e: Error) => setErr(e.message),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => remove(id),
    onSuccess: async () => { await refresh(); toast.success(`${noun} gelöscht.`) },
    onError: (e: Error) => setErr(e.message),
  })

  function add() {
    const name = newName.trim()
    setErr(null)
    if (!name) return
    if (taken(name)) { setErr(`${noun} „${name}“ gibt es schon.`); return }
    createMut.mutate(name)
  }
  function startEdit(r: StammdatenItem) { setErr(null); setEditId(r.ID); setEditName(r.ABBR) }
  function saveEdit(r: StammdatenItem) {
    const name = editName.trim()
    if (!name) { setErr('Der Name darf nicht leer sein.'); return }
    if (name === r.ABBR) { setEditId(null); return }
    if (taken(name, r.ID)) { setErr(`${noun} „${name}“ gibt es schon.`); return }
    setErr(null)
    updateMut.mutate({ id: r.ID, name })
  }
  async function askDelete(r: StammdatenItem) {
    setErr(null)
    const ok = await confirm({
      title: `${noun} löschen?`,
      message: `„${r.ABBR}“ wird gelöscht. Wird ${noun === 'Abteilung' ? 'sie' : 'er'} noch verwendet, bleibt ${noun === 'Abteilung' ? 'sie' : 'er'} stehen, und Sie sehen, wo.`,
      confirmLabel: 'Löschen',
    })
    if (ok) deleteMut.mutate(r.ID)
  }

  return (
    <FormSection title={title} hint={hint} layout="block" className="st-section">
      {canEdit && (
        <div className="st-add">
          <label htmlFor={inputId} className="st-add-label">Neue {noun}</label>
          <div className="st-add-row">
            <input id={inputId} type="text" value={newName} maxLength={100} autoComplete="off"
              placeholder="Name eingeben …"
              onChange={e => { setNewName(e.target.value); setErr(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
            <button type="button" className="btn-primary st-btn" onClick={add} disabled={!newName.trim() || createMut.isPending}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" />{createMut.isPending ? 'Legt an …' : 'Hinzufügen'}
            </button>
          </div>
        </div>
      )}

      <Message type="error" text={err} />

      {isLoading ? <p className="empty-note">Lädt …</p>
        : isError ? <Message type="error" text={`${title} konnten nicht geladen werden.`} />
        : rows.length === 0 ? <p className="st-empty">{canEdit ? emptyText : `Noch keine ${title}.`}</p>
        : (
          <ul className="st-list" aria-label={title}>
            {rows.map(r => (
              <li key={r.ID} className="st-list-row">
                {editId === r.ID ? (
                  <>
                    <input type="text" className="st-list-input" value={editName} autoFocus maxLength={100}
                      aria-label={`Neuer Name für ${r.ABBR}`}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); saveEdit(r) }
                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditId(null) }
                      }} />
                    <span className="st-row-actions">
                      <button type="button" className="row-action-btn" onClick={() => saveEdit(r)} disabled={updateMut.isPending}
                        aria-label={`Namen für ${r.ABBR} speichern`} title="Speichern (Enter)">
                        <Check size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button type="button" className="row-action-btn" onClick={() => setEditId(null)}
                        aria-label="Umbenennen abbrechen" title="Abbrechen (Esc)">
                        <X size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="st-list-name">{r.ABBR}</span>
                    {canEdit && (
                      <span className="st-row-actions">
                        <button type="button" className="row-action-btn" onClick={() => startEdit(r)}
                          aria-label={`${noun} ${r.ABBR} umbenennen`} title="Umbenennen">
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void askDelete(r)}
                          disabled={deleteMut.isPending} aria-label={`${noun} ${r.ABBR} löschen`} title="Löschen">
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      {!canEdit && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Stammdaten bearbeiten“.</p>}
      {confirmDialog}
    </FormSection>
  )
}
