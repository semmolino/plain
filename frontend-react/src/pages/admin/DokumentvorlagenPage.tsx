import { useState } from 'react'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionBar } from '@/components/ui/ActionBar'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { HelpHint } from '@/components/ui/HelpHint'
import { Modal } from '@/components/ui/Modal'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { LimitBanner } from '@/components/ui/LimitBanner'
import { Message } from '@/components/ui/Message'
import { DocPreview } from '@/components/vorlagen/DocPreview'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import {
  DEFAULT_THEME, archiveVariant, createVariant, fetchBranding, fetchCatalog, fetchVariant, fetchVariants,
  openBrandingPdf, previewBranding, saveBranding, saveVariant,
  type DocCatalog, type DocTheme,
} from '@/api/documentTemplates'
import { fetchDocumentTexts } from '@/api/documentTexts'
import { SegmentNav } from '@/pages/mitarbeiter/SegmentNav'
import { GestaltungPanel } from './dokumentvorlagen/GestaltungPanel'
import { AufbauPanel } from './dokumentvorlagen/AufbauPanel'
import { TextePanel } from './dokumentvorlagen/TextePanel'

/**
 * Einstellungen → Dokumentvorlagen (Vorlagen-Plan 10/2026, Stufe 2).
 *
 * Drei Unterreiter in der URL (`?tab=dokumentvorlagen&sub=…`):
 *   gestaltung — Stil, Hausfarbe, Schrift, Logo
 *   aufbau     — Bausteine und Anhänge je Belegart
 *   texte      — Standardtexte und Textbausteine
 *
 * Gestaltung und Aufbau sind EIN Entwurf mit einem Speichern — beides landet
 * im selben Theme. Vorher speicherte die Seite ohne Rückfrage bei offenen
 * Änderungen, und die Texte saßen in einem zweiten Formular darunter, dessen
 * Strg+S nur die gerade gewählte Belegart speicherte.
 */

const SUBS = [
  { id: 'gestaltung', label: 'Gestaltung', perm: 'settings.document_templates.edit' },
  { id: 'aufbau',     label: 'Aufbau',     perm: 'settings.document_templates.edit' },
  { id: 'texte',      label: 'Texte',      perm: 'settings.text_templates.edit' },
] as const
type Sub = typeof SUBS[number]['id']

function mergeTheme(t?: Partial<DocTheme> | null): DocTheme {
  return {
    ...DEFAULT_THEME,
    ...(t ?? {}),
    brand:  { ...DEFAULT_THEME.brand,  ...(t?.brand  ?? {}) },
    header: { ...DEFAULT_THEME.header, ...(t?.header ?? {}) },
    blocks: { ...DEFAULT_THEME.blocks, ...(t?.blocks ?? {}) },
  }
}

/** Gestaltung + Aufbau: ein gemeinsamer Entwurf über dem gespeicherten Theme. */
function DesignArea({ sub, active, catalog, category, onCategory, variantId }: {
  sub:        'gestaltung' | 'aufbau'
  /** bearbeitete Variante; null = Standard */
  variantId:  number | null
  /** sichtbar — nur dann gilt Strg+S hier */
  active:     boolean
  catalog:    DocCatalog
  category:   string
  onCategory: (key: string) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const themeKey = variantId ? ['doc-variant', variantId] : ['doc-branding']
  const { data, isLoading, error } = useQuery({
    queryKey: themeKey,
    queryFn: () => (variantId ? fetchVariant(variantId).then(r => ({ theme: r.data.theme })) : fetchBranding().then(r => r.data)),
  })
  const { data: snippets } = useQuery({ queryKey: ['document-texts'], queryFn: () => fetchDocumentTexts().then(r => r.data) })
  const [edits, setEdits] = useState<DocTheme | null>(null)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const saved = mergeTheme(data?.theme)
  const theme = edits ?? saved
  const dirty = edits !== null && JSON.stringify(edits) !== JSON.stringify(saved)

  function change(fn: (t: DocTheme) => DocTheme) {
    setErr(null)
    setEdits(e => fn(e ?? saved))
  }

  async function save() {
    setPending(true); setErr(null)
    try {
      if (variantId) await saveVariant(variantId, { theme_json: theme })
      else await saveBranding(theme)
      await qc.invalidateQueries({ queryKey: themeKey })
      setEdits(null)
      toast.success(variantId ? 'Vorlage gespeichert. Gilt für neue Belege, die sie wählen.' : 'Dokumentvorlage gespeichert. Gilt für alle neuen Belege.')
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
      throw e
    } finally {
      setPending(false)
    }
  }

  async function discard() {
    const ok = await confirm({ title: 'Änderungen verwerfen?', message: 'Die Dokumentvorlage bleibt, wie sie gespeichert ist.', confirmLabel: 'Verwerfen' })
    if (ok) { setEdits(null); setErr(null) }
  }

  useRegisterDirty('dokumentvorlagen', { dirty, label: 'Dokumentvorlage', save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, active)

  const previewKey = JSON.stringify([theme, category])

  if (isLoading) return <p className="dv-empty">Lade …</p>
  if (error) return <Message type="error" text={(error as Error).message} />

  return (
    <div className="dv-split">
      <fieldset className="ws-form-fields dv-controls" disabled={pending}>
        <legend className="sr-only">{sub === 'aufbau' ? 'Aufbau' : 'Gestaltung'}</legend>
        {sub === 'gestaltung'
          ? <GestaltungPanel theme={theme} onChange={change} />
          : <AufbauPanel theme={theme} onChange={change} catalog={catalog} category={category} onCategory={onCategory} snippets={snippets ?? []} />}
        <Message type="error" text={err} />
      </fieldset>
      <div className="dv-side">
        {sub === 'gestaltung' && (
          <div className="form-group dv-preview-pick">
            <label htmlFor="dv-preview-cat">Vorschau für</label>
            <select id="dv-preview-cat" value={category} onChange={e => onCategory(e.target.value)}>
              {catalog.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        )}
        <DocPreview requestKey={previewKey} load={() => previewBranding(theme, category).then(r => r.html)} />
        {/* Briefpapier, Falzmarken und Folgeseitenkopf gibt es nur im PDF */}
        <button type="button" className="btn-small dv-pdf-btn" onClick={() => void openBrandingPdf(theme, category).catch((e: Error) => toast.error(e.message))}>
          <FileText size={13} strokeWidth={2} /> Als PDF ansehen
        </button>
      </div>
      <ActionBar
        dirty={dirty}
        quiet={!dirty && !pending}
        status={pending ? 'Speichert …' : dirty ? 'Ungespeicherte Änderungen' : 'Keine Änderungen'}
        secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={pending}>Verwerfen</button> : undefined}
      >
        <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
          {pending ? 'Speichert …' : 'Speichern'}
        </button>
      </ActionBar>
      {confirmDialog}
    </div>
  )
}

/**
 * Welche Vorlage bearbeitet wird: der Standard oder eine benannte Variante
 * (Stufe 5, D3). Varianten wählt man je Beleg im Rechnungsassistenten.
 */
function VariantBar({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const { data } = useQuery({ queryKey: ['doc-variants'], queryFn: () => fetchVariants().then(r => r.data) })
  const variants = Array.isArray(data) ? data : []
  const current = variants.find(v => v.id === value) ?? null
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: async () => {
      if (dialog === 'rename' && current) { await saveVariant(current.id, { name }); return current.id }
      return (await createVariant(name, Number(copyFrom) || null)).data.id
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ['doc-variants'] })
      toast.success(dialog === 'rename' ? 'Vorlage umbenannt.' : 'Vorlage angelegt.')
      setDialog(null)
      if (dialog === 'new') onChange(id)
    },
    onError: (e: Error) => setErr(e.message),
  })

  async function remove() {
    if (!current) return
    const ok = await confirm({
      title: 'Vorlage entfernen?',
      message: `„${current.name}“ steht dann nicht mehr zur Wahl. Gebuchte Belege behalten ihre Gestaltung; Entwürfe, die sie tragen, rendern weiter damit.`,
      confirmLabel: 'Entfernen',
    })
    if (!ok) return
    try {
      await archiveVariant(current.id)
      await qc.invalidateQueries({ queryKey: ['doc-variants'] })
      onChange(null)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="dv-variants">
      <div className="form-group">
        <label htmlFor="dv-variant" className="ws-label-help">Vorlage <HelpHint id="vorlagen.varianten" size={13} /></label>
        <select id="dv-variant" value={value ?? ''} onChange={e => onChange(Number(e.target.value) || null)}>
          <option value="">Standard</option>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div className="dv-variants-actions">
        <button type="button" className="btn-small" onClick={() => { setName(''); setCopyFrom(value ? String(value) : ''); setErr(null); setDialog('new') }}>
          <Plus size={13} strokeWidth={2} /> Neue Vorlage
        </button>
        {current && (
          <>
            <button type="button" className="btn-small" onClick={() => { setName(current.name); setErr(null); setDialog('rename') }}>
              <Pencil size={13} strokeWidth={2} /> Umbenennen
            </button>
            <button type="button" className="btn-small" onClick={() => void remove()}>
              <Trash2 size={13} strokeWidth={2} /> Entfernen
            </button>
          </>
        )}
      </div>

      <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === 'rename' ? 'Vorlage umbenennen' : 'Neue Vorlage'}>
        <div className="form-group">
          <label htmlFor="dv-variant-name">Name</label>
          <input id="dv-variant-name" className="form-control" maxLength={80} value={name} autoFocus
            onChange={e => { setName(e.target.value); setErr(null) }} placeholder="z. B. Öffentliche Auftraggeber" />
        </div>
        {dialog === 'new' && (
          <div className="form-group">
            <label htmlFor="dv-variant-copy">Ausgangspunkt</label>
            <select id="dv-variant-copy" value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
              <option value="">Kopie des Standards</option>
              {variants.map(v => <option key={v.id} value={v.id}>Kopie von „{v.name}“</option>)}
            </select>
          </div>
        )}
        <Message type="error" text={err} />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => setDialog(null)}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Speichert …' : dialog === 'rename' ? 'Umbenennen' : 'Anlegen'}
          </button>
        </DialogFooter>
      </Modal>
      {confirmDialog}
    </div>
  )
}

export function DokumentvorlagenPage() {
  const [params, setParams] = useSearchParams()
  const narrow = useIsNarrow()
  const canDesign = usePermission('settings.document_templates.edit')
  const canTexts = usePermission('settings.text_templates.edit')
  const allowed = SUBS.filter(s => (s.perm === 'settings.text_templates.edit' ? canTexts : canDesign))
  const raw = params.get('sub')
  const sub: Sub = allowed.some(s => s.id === raw) ? raw as Sub : (allowed[0]?.id ?? 'gestaltung')

  const { data: catalog, error } = useQuery({ queryKey: ['doc-catalog'], queryFn: () => fetchCatalog().then(r => r.data), staleTime: 10 * 60_000 })
  const category = catalog?.categories.some(c => c.key === params.get('cat')) ? params.get('cat')! : 'invoice_rechnung'
  const textType = params.get('type') ?? catalog?.textTypes[0]?.type ?? ''
  const variantId = Number(params.get('v')) || null
  const guarded = useGuardedAction()

  // Gestaltung, Aufbau und Texte bleiben eingehängt: ein Wechsel des Unterreiters
  // verliert nichts, gefragt wird erst beim Verlassen der Seite.
  function setParam(changes: Record<string, string>) {
    const p = new URLSearchParams(params)
    p.set('tab', 'dokumentvorlagen')
    for (const [k, v] of Object.entries(changes)) { if (v) p.set(k, v); else p.delete(k) }
    setParams(p, { replace: true })
  }

  if (!allowed.length) return null
  if (error) return <Message type="error" text={(error as Error).message} />

  return (
    <div className="dv-page">
      <LimitBanner capability="limits.storage_mb" />
      <p className="ws-form-intro">
        So sehen deine Belege aus — für alle Belegarten von der Rechnung bis zur Mahnung. Bereits gebuchte Belege bleiben unverändert.
      </p>
      {allowed.length > 1 && (narrow ? (
        <div className="st-sub-select">
          <label htmlFor="dv-sub">Bereich</label>
          <select id="dv-sub" value={sub} onChange={e => setParam({ sub: e.target.value })}>
            {allowed.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      ) : (
        <SegmentNav items={allowed.map(s => ({ id: s.id, label: s.label }))} active={sub} onChange={id => setParam({ sub: id })} />
      ))}

      {!catalog ? <p className="dv-empty">Lade …</p> : (
        <>
          {canDesign && (
            <div hidden={sub === 'texte'}>
              <VariantBar value={variantId} onChange={v => guarded(() => setParam({ v: v ? String(v) : '' }))} />
              <DesignArea key={variantId ?? 'std'} variantId={variantId} sub={sub === 'aufbau' ? 'aufbau' : 'gestaltung'} active={sub !== 'texte'} catalog={catalog} category={category} onCategory={c => setParam({ cat: c })} />
            </div>
          )}
          {canTexts && (
            <div hidden={sub !== 'texte'}>
              <TextePanel catalog={catalog} activeType={textType} onActiveType={t => setParam({ type: t })} visible={sub === 'texte'} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
