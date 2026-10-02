import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'
import { Modal } from '@/components/ui/Modal'
import { PlaceholderChips } from '@/components/vorlagen/PlaceholderChips'
import { insertAtCursor } from '@/components/vorlagen/insertAtCursor'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useToast } from '@/store/toastStore'
import { fetchTextTemplates, saveTextTemplate, type TextTemplate } from '@/api/mahnungen'
import type { DocCatalog } from '@/api/documentTemplates'
import {
  createDocumentText, deleteDocumentText, fetchDocumentTexts, updateDocumentText,
  TEXT_POSITION_LABELS, type DocumentText, type DocumentTextInput,
} from '@/api/documentTexts'

type Field = 'headerText' | 'footerText'
type Texts = Pick<TextTemplate, 'headerText' | 'footerText'>
const EMPTY: Texts = { headerText: null, footerText: null }
const norm = (s: string | null | undefined) => (s ?? '').trim() ? s! : null

// ── Standardtexte je Belegart ────────────────────────────────────────────────

function StandardTexte({ catalog, active, onActive, visible, children }: {
  catalog:  DocCatalog
  active:   string
  onActive: (type: string) => void
  visible:  boolean
  /** steht zwischen den Texten und der Aktionsleiste (die gehört ans Seitenende) */
  children: ReactNode
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const { data, isLoading } = useQuery({ queryKey: ['text-templates'], queryFn: () => fetchTextTemplates().then(r => r.data) })
  const saved: Record<string, Texts> = Object.fromEntries((data ?? []).map(t => [t.documentType, { headerText: t.headerText, footerText: t.footerText }]))
  const [edits, setEdits] = useState<Record<string, Texts>>({})
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [field, setField] = useState<Field>('headerText')
  const refs = { headerText: useRef<HTMLTextAreaElement>(null), footerText: useRef<HTMLTextAreaElement>(null) }

  const types = catalog.textTypes
  const type = types.find(t => t.type === active) ?? types[0]
  const value = (k: string): Texts => edits[k] ?? saved[k] ?? EMPTY
  const changedTypes = Object.keys(edits).filter(k => {
    const s = saved[k] ?? EMPTY
    return norm(edits[k].headerText) !== norm(s.headerText) || norm(edits[k].footerText) !== norm(s.footerText)
  })
  const dirty = changedTypes.length > 0

  function set(f: Field, v: string) {
    setErr(null)
    setEdits(e => ({ ...e, [type.type]: { ...value(type.type), [f]: v } }))
  }

  async function save() {
    setPending(true); setErr(null)
    try {
      // nacheinander: ein Fehler bei einer Belegart lässt die übrigen stehen
      for (const k of changedTypes) {
        await saveTextTemplate(k, { headerText: norm(edits[k].headerText), footerText: norm(edits[k].footerText) })
        setEdits(e => { const n = { ...e }; delete n[k]; return n })
      }
      await qc.invalidateQueries({ queryKey: ['text-templates'] })
      setEdits({})
      toast.success(changedTypes.length === 1 ? 'Text gespeichert.' : `${changedTypes.length} Texte gespeichert.`)
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
      throw e
    } finally {
      setPending(false)
    }
  }

  async function discard() {
    const ok = await confirm({ title: 'Änderungen verwerfen?', message: 'Die Texte bleiben, wie sie gespeichert sind.', confirmLabel: 'Verwerfen' })
    if (ok) { setEdits({}); setErr(null) }
  }

  useRegisterDirty('dokumentvorlagen-texte', { dirty, label: 'Standardtexte', count: changedTypes.length, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, visible)

  if (isLoading || !type) return <div className="dv-texte"><p className="dv-empty">Lade …</p>{children}</div>
  const cur = value(type.type)
  const fallback = type.fallbackLabel && !norm(cur.headerText) && !norm(cur.footerText)

  return (
    <div className="dv-texte">
      <FormSection title="Standardtexte" help="vorlagen.standardtexte" layout="block"
        hint="Kopf- und Fußtext je Belegart. Im Beleg selbst lassen sie sich abweichend eintragen.">
        <div className="text-template-types" role="group" aria-label="Standardtext für">
          {types.map(t => (
            <button key={t.type} type="button" aria-pressed={t.type === type.type}
              className={`text-template-type-btn${t.type === type.type ? ' active' : ''}`} onClick={() => onActive(t.type)}>
              {t.label}{changedTypes.includes(t.type) && <span className="dv-dot" aria-label="geändert" />}
            </button>
          ))}
        </div>
        {fallback && <p className="dv-hint">Leer — es gilt der Text der {type.fallbackLabel}.</p>}
        <PlaceholderChips placeholders={catalog.placeholders} category={type.category}
          onInsert={tok => set(field, insertAtCursor(refs[field], cur[field] ?? '', tok))} />
        <div className="form-group">
          <label htmlFor="dv-header">Kopftext — vor den Positionen</label>
          <textarea id="dv-header" ref={refs.headerText} className="form-control" rows={5} maxLength={4000}
            value={cur.headerText ?? ''} disabled={pending}
            onFocus={() => setField('headerText')} onChange={e => set('headerText', e.target.value)}
            placeholder="z. B. „für unsere Leistungen im Zeitraum {{leistungszeitraum}} berechnen wir …“" />
        </div>
        <div className="form-group">
          <label htmlFor="dv-footer">Fußtext — nach den Beträgen</label>
          <textarea id="dv-footer" ref={refs.footerText} className="form-control" rows={5} maxLength={4000}
            value={cur.footerText ?? ''} disabled={pending}
            onFocus={() => setField('footerText')} onChange={e => set('footerText', e.target.value)}
            placeholder="z. B. Zahlungshinweis, Grußformel …" />
        </div>
        <Message type="error" text={err} />
      </FormSection>
      {children}
      {visible && (
        <ActionBar
          dirty={dirty}
          quiet={!dirty && !pending}
          status={pending ? 'Speichert …' : dirty ? `${changedTypes.length} ${changedTypes.length === 1 ? 'Text' : 'Texte'} geändert` : 'Keine Änderungen'}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
            {pending ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
      )}
      {confirmDialog}
    </div>
  )
}

// ── Textbausteine ────────────────────────────────────────────────────────────

function SnippetDialog({ catalog, row, onClose }: { catalog: DocCatalog; row: DocumentText | 'new'; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const init: DocumentTextInput = row === 'new'
    ? { label: '', text: '', category: null, position: 'free' }
    : { label: row.label, text: row.text, category: row.category, position: row.position }
  const [form, setForm] = useState<DocumentTextInput>(init)
  const [err, setErr] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const mut = useMutation({
    mutationFn: () => row === 'new' ? createDocumentText(form) : updateDocumentText(row.id, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['document-texts'] })
      toast.success(row === 'new' ? 'Textbaustein angelegt.' : 'Textbaustein gespeichert.')
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  const missing = !form.label.trim() || !form.text.trim()
  return (
    <Modal open onClose={onClose} title={row === 'new' ? 'Neuer Textbaustein' : 'Textbaustein bearbeiten'}>
      <form onSubmit={e => { e.preventDefault(); if (!missing) mut.mutate() }}>
        <div className="form-group">
          <label htmlFor="dv-sn-label">Bezeichnung</label>
          <input id="dv-sn-label" className="form-control" maxLength={120} value={form.label} autoFocus
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="z. B. Gewährleistung" />
        </div>
        <div className="dv-sn-grid">
          <div className="form-group">
            <label htmlFor="dv-sn-cat">Belegart</label>
            <select id="dv-sn-cat" value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value || null }))}>
              <option value="">Alle Belegarten</option>
              {catalog.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="dv-sn-pos">Verwendung</label>
            <select id="dv-sn-pos" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value as DocumentText['position'] }))}>
              {(Object.keys(TEXT_POSITION_LABELS) as DocumentText['position'][]).map(p => <option key={p} value={p}>{TEXT_POSITION_LABELS[p]}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="dv-sn-text">Text</label>
          <textarea id="dv-sn-text" ref={textRef} className="form-control" rows={6} maxLength={4000} value={form.text}
            onChange={e => setForm(f => ({ ...f, text: e.target.value }))} />
        </div>
        <PlaceholderChips placeholders={catalog.placeholders} category={form.category}
          onInsert={tok => setForm(f => ({ ...f, text: insertAtCursor(textRef, f.text, tok) }))} />
        <Message type="error" text={err} />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={missing || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Speichert …' : 'Speichern'}</button>
        </DialogFooter>
      </form>
    </Modal>
  )
}

function Textbausteine({ catalog }: { catalog: DocCatalog }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [open, setOpen] = useState<DocumentText | 'new' | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['document-texts'], queryFn: () => fetchDocumentTexts().then(r => r.data) })
  const rows = data ?? []
  const catLabel = Object.fromEntries(catalog.categories.map(c => [c.key, c.label]))

  async function remove(r: DocumentText) {
    const ok = await confirm({ title: 'Textbaustein löschen?', message: `„${r.label}“ wird gelöscht. Belege, die den Text schon enthalten, behalten ihn.`, confirmLabel: 'Löschen' })
    if (!ok) return
    try {
      await deleteDocumentText(r.id)
      await qc.invalidateQueries({ queryKey: ['document-texts'] })
      toast.success('Textbaustein gelöscht.')
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <FormSection title="Textbausteine" help="vorlagen.textbausteine" layout="block"
      hint="Wiederkehrende Texte, die sich in einen Beleg übernehmen lassen — als Kopf-, Fußtext oder eigener Textblock."
      actions={<button type="button" className="btn-small" onClick={() => setOpen('new')}><Plus size={13} strokeWidth={2} /> Textbaustein</button>}>
      {isLoading ? <p className="dv-empty">Lade …</p>
        : rows.length === 0 ? (
          <p className="dv-empty">
            Noch keine Textbausteine. Lege Texte, die du öfter brauchst — etwa einen Hinweis zur Gewährleistung oder
            zur Abnahme —, einmal hier an; danach stehen sie im Aufbau eines Belegs zur Auswahl, statt jedes Mal neu getippt zu werden.
          </p>
        ) : (
          <ul className="dv-snippets">
            {rows.map(r => (
              <li key={r.id} className="dv-snippet">
                <div className="dv-snippet-main">
                  <strong>{r.label}</strong>
                  <span className="dv-snippet-meta">{r.category ? catLabel[r.category] ?? r.category : 'Alle Belegarten'} · {TEXT_POSITION_LABELS[r.position]}</span>
                  <span className="dv-snippet-text">{r.text}</span>
                </div>
                <span className="dv-row-actions">
                  <button type="button" className="row-action-btn" onClick={() => setOpen(r)} aria-label={`${r.label} bearbeiten`}><Pencil size={14} strokeWidth={2} /></button>
                  <button type="button" className="row-action-btn" onClick={() => void remove(r)} aria-label={`${r.label} löschen`}><Trash2 size={14} strokeWidth={2} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      {open && <SnippetDialog catalog={catalog} row={open} onClose={() => setOpen(null)} />}
      {confirmDialog}
    </FormSection>
  )
}

export function TextePanel({ catalog, activeType, onActiveType, visible }: {
  catalog:      DocCatalog
  activeType:   string
  onActiveType: (type: string) => void
  visible:      boolean
}) {
  return (
    <>
      <StandardTexte catalog={catalog} active={activeType} onActive={onActiveType} visible={visible}>
        <Textbausteine catalog={catalog} />
      </StandardTexte>
    </>
  )
}
