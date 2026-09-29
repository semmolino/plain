import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Lock, Pencil, Plus, Trash2, X } from 'lucide-react'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import type { HelpId } from '@/help/helpContent'
import {
  fetchStatusCatalog, createStatusEntry, updateStatusEntry, deleteStatusEntry, reorderStatusEntries,
  type StatusCatalogItem, type StatusKind,
} from '@/api/stammdaten'

/**
 * Projekt- und Angebotsstatus des Büros (UI-Pilot Runde 13, Migration 0176).
 *
 * Bis dahin eine Liste für alle Büros, die niemand pflegen konnte. Jetzt
 * eigene Liste je Büro: anlegen, umbenennen, sortieren (die Reihenfolge gilt
 * in jeder Auswahl), löschen, solange nichts daran hängt. „Beauftragt" und
 * „Abgelehnt" tragen Logik — sie lassen sich umbenennen, aber nicht löschen.
 */

const CONF: Record<StatusKind, { title: string; noun: string; help: HelpId; hint: string; empty: string; listKey: string }> = {
  project: {
    title: 'Projektstatus', noun: 'Projektstatus', help: 'settings.projektstatus', listKey: 'project-statuses',
    hint: 'In welcher Phase ein Projekt steht. Welche Status als „laufend" gelten, legt Einstellungen → Monatsabschluss fest.',
    empty: 'Noch keine Projektstatus — ohne Status lässt sich kein Projekt anlegen. Legen Sie z. B. „Laufend" und „Abgeschlossen" an.',
  },
  offer: {
    title: 'Angebotsstatus', noun: 'Angebotsstatus', help: 'settings.angebotsstatus', listKey: 'offer-statuses',
    hint: 'Wo ein Angebot steht. Die Reihenfolge gilt in jeder Auswahlliste.',
    empty: 'Noch keine Angebotsstatus — ohne Status lässt sich kein Angebot anlegen.',
  },
}

export function StatusEditor({ kind }: { kind: StatusKind }) {
  const c = CONF[kind]
  const qc = useQueryClient()
  const toast = useToast()
  const canEdit = usePermission('settings.basedata.edit')
  const [confirm, confirmDialog] = useConfirm()
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const inputId = useId()

  const key = ['status-catalog', kind]
  const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => fetchStatusCatalog(kind) })
  const rows = data?.data ?? []
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: [c.listKey] })
  }
  const taken = (name: string, except?: number) =>
    rows.some(r => r.ID !== except && r.ABBR.trim().toLocaleLowerCase('de') === name.trim().toLocaleLowerCase('de'))

  const createMut = useMutation({
    mutationFn: (name: string) => createStatusEntry(kind, name),
    onSuccess: async (_r, name) => { await refresh(); setNewName(''); toast.success(`„${name}“ angelegt.`) },
    onError: (e: Error) => setErr(e.message),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateStatusEntry(kind, id, name),
    onSuccess: async () => { await refresh(); setEditId(null) },
    onError: (e: Error) => setErr(e.message),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteStatusEntry(kind, id),
    onSuccess: async () => { await refresh(); toast.success(`${c.noun} gelöscht.`) },
    onError: (e: Error) => setErr(e.message),
  })
  const orderMut = useMutation({
    mutationFn: (ids: number[]) => reorderStatusEntries(kind, ids),
    // Sofort anzeigen, was man verschoben hat — der Server bestätigt oder widerspricht.
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<{ data: StatusCatalogItem[] }>(key)
      if (prev) qc.setQueryData(key, { data: ids.map(id => prev.data.find(r => r.ID === id)!).filter(Boolean) })
      return { prev }
    },
    onError: (e: Error, _ids, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); setErr(e.message) },
    onSettled: () => void refresh(),
  })

  function add() {
    const name = newName.trim()
    setErr(null)
    if (!name) return
    if (taken(name)) { setErr(`${c.noun} „${name}“ gibt es schon.`); return }
    createMut.mutate(name)
  }
  function saveEdit(r: StatusCatalogItem) {
    const name = editName.trim()
    if (!name) { setErr('Der Name darf nicht leer sein.'); return }
    if (name === r.ABBR) { setEditId(null); return }
    if (taken(name, r.ID)) { setErr(`${c.noun} „${name}“ gibt es schon.`); return }
    setErr(null)
    updateMut.mutate({ id: r.ID, name })
  }
  function move(index: number, dir: -1 | 1) {
    const ids = rows.map(r => r.ID)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    setErr(null)
    orderMut.mutate(ids)
  }
  async function askDelete(r: StatusCatalogItem) {
    setErr(null)
    // Was noch daran hängt, steht schon in der Zeile — sagen statt fragen.
    if (r.USAGE.refs.length) {
      setErr(`„${r.ABBR}“ wird noch verwendet: ${r.USAGE.refs.join(', ')}. Erst dort umstellen, dann löschen.`)
      return
    }
    const ok = await confirm({ title: `${c.noun} löschen?`, message: `„${r.ABBR}“ wird gelöscht.`, confirmLabel: 'Löschen' })
    if (ok) deleteMut.mutate(r.ID)
  }

  return (
    <FormSection title={c.title} help={c.help} hint={c.hint} layout="block" className="st-section">
      {canEdit && (
        <div className="st-add">
          <label htmlFor={inputId} className="st-add-label">Neuer {c.noun}</label>
          <div className="st-add-row">
            <input id={inputId} type="text" value={newName} maxLength={60} autoComplete="off" placeholder="Name eingeben …"
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
        : isError ? <Message type="error" text={`${c.title} konnten nicht geladen werden.`} />
        : rows.length === 0 ? <p className="st-empty">{c.empty}</p>
        : (
          <ol className="st-list st-status-list" aria-label={c.title}>
            {rows.map((r, i) => (
              <li key={r.ID} className="st-list-row st-status-row">
                {editId === r.ID ? (
                  <>
                    <input type="text" className="st-list-input" value={editName} autoFocus maxLength={60}
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
                    <span className="st-status-main">
                      <span className="st-list-name">
                        {r.ABBR}
                        {r.CODE && (
                          <span className="st-badge st-badge--system" title={r.CODE_HINT}>
                            <Lock size={11} strokeWidth={2} aria-hidden="true" />System
                          </span>
                        )}
                      </span>
                      <span className="st-status-sub">
                        {r.CODE_HINT ? `${r.CODE_HINT[0].toUpperCase()}${r.CODE_HINT.slice(1)}.` : null}
                        {r.CODE_HINT && r.USAGE.refs.length ? ' ' : null}
                        {r.USAGE.refs.length ? `Verwendet: ${r.USAGE.refs.join(', ')}` : r.CODE_HINT ? null : 'nicht verwendet'}
                      </span>
                    </span>
                    {canEdit && (
                      <span className="st-row-actions">
                        <button type="button" className="row-action-btn" onClick={() => move(i, -1)} disabled={i === 0 || orderMut.isPending}
                          aria-label={`${r.ABBR} nach oben`} title="Nach oben">
                          <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button type="button" className="row-action-btn" onClick={() => move(i, 1)} disabled={i === rows.length - 1 || orderMut.isPending}
                          aria-label={`${r.ABBR} nach unten`} title="Nach unten">
                          <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button type="button" className="row-action-btn" onClick={() => { setErr(null); setEditId(r.ID); setEditName(r.ABBR) }}
                          aria-label={`${r.ABBR} umbenennen`} title="Umbenennen">
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        {!r.CODE && (
                          <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void askDelete(r)}
                            disabled={deleteMut.isPending} aria-label={`${r.ABBR} löschen`} title="Löschen">
                            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      {!canEdit && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Stammdaten bearbeiten“.</p>}
      {confirmDialog}
    </FormSection>
  )
}
