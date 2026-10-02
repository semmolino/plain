import { useRef, useState } from 'react'
import { Eye, RotateCcw } from 'lucide-react'
import { Disclosure } from '@/components/ui/Disclosure'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { HelpHint } from '@/components/ui/HelpHint'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/hooks/useConfirm'
import type { PlaceholderInfo } from '@/api/documentTemplates'
import type { DocumentText } from '@/api/documentTexts'
import { DocPreview } from './DocPreview'
import { LayoutEditor } from './LayoutEditor'
import { PlaceholderChips } from './PlaceholderChips'
import { insertAtCursor } from './insertAtCursor'
import { differs } from './layoutModel'
import type { BelegAufbau as Ctl } from './useBelegAufbau'

/** Kopf- oder Fußtext dieses Belegs: frei, aus Textbaustein oder Standard. */
function BelegText({ id, label, value, fallback, isOwn, onChange, onReset, snippets, placeholders, category, disabled }: {
  id:           string
  label:        string
  value:        string | null
  fallback:     string | null
  isOwn:        boolean
  onChange:     (v: string) => void
  onReset:      () => void
  snippets:     DocumentText[]
  placeholders: PlaceholderInfo[]
  category:     string
  disabled?:    boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [focus, setFocus] = useState(false)
  const text = value ?? fallback ?? ''
  return (
    <div className="form-group ba-text">
      <div className="ba-text-head">
        <label htmlFor={id}>{label}</label>
        {isOwn && <span className="dv-badge">eigener Text</span>}
        {snippets.length > 0 && (
          <select className="dv-select" aria-label={`${label} aus Textbaustein`} value="" disabled={disabled}
            onChange={e => { const s = snippets.find(x => String(x.id) === e.target.value); if (s) onChange(s.text) }}>
            <option value="">Aus Textbaustein …</option>
            {snippets.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        {isOwn && (
          <button type="button" className="btn-small" onClick={onReset} disabled={disabled}>
            <RotateCcw size={13} strokeWidth={2} /> Standardtext
          </button>
        )}
      </div>
      <textarea id={id} ref={ref} className="form-control" rows={3} maxLength={4000} value={text} disabled={disabled}
        placeholder="Leer — erscheint nicht auf dem Beleg."
        onFocus={() => setFocus(true)} onChange={e => onChange(e.target.value)} />
      {focus && <PlaceholderChips placeholders={placeholders} category={category} onInsert={tok => onChange(insertAtCursor(ref, text, tok))} />}
    </div>
  )
}

/**
 * „Aufbau und Texte dieses Belegs" im Schritt „Prüfen & buchen" der
 * Rechnungsassistenten (Vorlagen-Plan Stufe 3). Zustand und Speichern stehen
 * in `useBelegAufbau` — gespeichert wird mit dem Schritt, nicht beim Tippen.
 */
export function BelegAufbau({ ctl, disabled, canPreview = true, beforePreview, releasePpIds }: {
  ctl:            Ctl
  disabled?:      boolean
  /** Vorschau braucht invoices.download_pdf */
  canPreview?:    boolean
  /** z. B. Nachlässe speichern, damit die Vorschau die Beträge zeigt */
  beforePreview?: () => Promise<unknown>
  releasePpIds?:  number[]
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  if (!ctl.ready || !ctl.cat || !ctl.info || !ctl.layers || !ctl.state) return null
  const { cat, info, layers, state } = ctl

  const ownDiff = differs(state, layers.project)
  const variant = ctl.variants.find(v => v.id === ctl.templateId)
  const hint = [
    ctl.templateId ? `Vorlage „${variant?.name ?? 'entfernt'}“` : null,
    ctl.remember ? 'für das Projekt gemerkt' : ownDiff ? 'eigener Aufbau' : info.project ? 'wie im Projekt' : 'wie die Vorlage',
  ].filter(Boolean).join(' · ')
  const forPos = (pos: DocumentText['position']) => ctl.snippets.filter(s => s.position === pos && (!s.category || s.category === cat.key))

  async function removeProject() {
    const ok = await confirm({
      title: 'Projekt-Aufbau entfernen?',
      message: `Künftige Belege dieser Art im Projekt folgen wieder der Firmenvorlage. Gebuchte Belege bleiben, wie sie sind.`,
      confirmLabel: 'Entfernen',
    })
    if (ok) await ctl.removeProjectLayout()
  }

  return (
    <>
      <Disclosure className="ba-panel" title="Aufbau und Texte dieses Belegs" hint={hint} help={<HelpHint id="vorlagen.beleg_aufbau" />}>
        {(ctl.variants.length > 0 || ctl.templateId) && (
          <div className="form-group ba-variant">
            <label htmlFor="ba-variant" className="ws-label-help">Vorlage <HelpHint id="vorlagen.varianten" size={13} /></label>
            <select id="ba-variant" value={ctl.templateId ?? ''} disabled={disabled} onChange={e => ctl.setTemplate(Number(e.target.value) || null)}>
              <option value="">Standard</option>
              {ctl.variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              {ctl.templateId && !variant && <option value={ctl.templateId}>(entfernte Vorlage)</option>}
            </select>
          </div>
        )}
        <div className="ba-texts">
          <BelegText id="ba-intro" label="Kopftext" value={state.introText} fallback={layers.project.introText ?? info.standardTexts.intro}
            isOwn={state.introText !== layers.project.introText}
            onChange={v => ctl.setState({ ...state, introText: v })} onReset={() => ctl.setState({ ...state, introText: layers.project.introText })}
            snippets={forPos('intro')} placeholders={ctl.placeholders} category={cat.key} disabled={disabled} />
          <BelegText id="ba-closing" label="Fußtext" value={state.closingText} fallback={layers.project.closingText ?? info.standardTexts.closing}
            isOwn={state.closingText !== layers.project.closingText}
            onChange={v => ctl.setState({ ...state, closingText: v })} onReset={() => ctl.setState({ ...state, closingText: layers.project.closingText })}
            snippets={forPos('closing')} placeholders={ctl.placeholders} category={cat.key} disabled={disabled} />
        </div>

        <p className="ba-sub">Bausteine</p>
        <LayoutEditor category={cat} value={state} onChange={ctl.setState} placeholders={ctl.placeholders}
          snippets={forPos('free')} disabled={disabled} />

        <div className="ba-actions">
          {info.canEditProject && info.projectId != null && (
            <label className="dv-check">
              <input type="checkbox" checked={ctl.remember} disabled={disabled} onChange={e => ctl.setRemember(e.target.checked)} />
              Für dieses Projekt merken — gilt für jede {cat.label} im Projekt
            </label>
          )}
          {ownDiff && (
            <button type="button" className="btn-small" onClick={ctl.resetDocument} disabled={disabled}>
              <RotateCcw size={13} strokeWidth={2} /> {info.project ? 'Wie im Projekt' : 'Wie die Vorlage'}
            </button>
          )}
          {info.canEditProject && info.project && (
            <button type="button" className="btn-small" onClick={() => void removeProject()} disabled={disabled}>Projekt-Aufbau entfernen</button>
          )}
          {canPreview && (
            <button type="button" className="btn-small ba-preview-btn" onClick={() => setPreviewOpen(true)}>
              <Eye size={13} strokeWidth={2} /> Vorschau
            </button>
          )}
        </div>
      </Disclosure>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Vorschau dieses Belegs" className="modal-xl">
        {previewOpen && (
          <DocPreview
            label="Vorschau dieses Belegs"
            note="Maßstabsgetreu, auf die Breite verkleinert. Mit dem Stand dieses Entwurfs — die Nummer bekommt er erst beim Buchen."
            requestKey={ctl.previewKey}
            load={async () => { await beforePreview?.(); return ctl.preview(releasePpIds) }}
          />
        )}
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(false)}>Schließen</button>
        </DialogFooter>
      </Modal>
      {confirmDialog}
    </>
  )
}
