import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Lock, Plus, ScissorsLineDashed, Trash2 } from 'lucide-react'
import type { CategoryInfo, PaymentMode, PlaceholderInfo } from '@/api/documentTemplates'
import type { DocumentText } from '@/api/documentTexts'
import { HelpHint } from '@/components/ui/HelpHint'
import { PlaceholderChips } from './PlaceholderChips'
import { insertAtCursor } from './insertAtCursor'
import { addText, moveEntry, removeEntry, updateEntry, type LayoutState } from './layoutModel'

const PAYMENT_LABELS: Record<PaymentMode, string> = {
  auto:   'Automatisch — nur ohne Fußtext',
  always: 'Immer',
  never:  'Nie',
}

/**
 * Aufbau des Hauptteils eines Belegs: Bausteine verschieben (Ziehen oder
 * Pfeile), ein-/ausblenden, Seitenumbruch davor, eigene Textblöcke.
 * Pflichtbausteine (Schloss) lassen sich verschieben, aber nicht ausblenden;
 * der Briefkopf steht immer zuerst. Dieselbe Komponente dient der Vorlage in
 * den Einstellungen und der Abweichung je Projekt oder Beleg.
 */
export function LayoutEditor({ category, value, onChange, placeholders, snippets = [], disabled }: {
  category:     CategoryInfo
  value:        LayoutState
  onChange:     (next: LayoutState) => void
  placeholders: PlaceholderInfo[]
  /** Textbausteine, aus denen sich ein Textblock übernehmen lässt */
  snippets?:    DocumentText[]
  disabled?:    boolean
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const textRefs = useRef(new Map<string, HTMLTextAreaElement | null>())
  const hasPayment = category.body.some(b => b.key === 'payment')
  const usable = snippets.filter(s => !s.category || s.category === category.key)

  function addBlock(text = '') {
    const { state, key } = addText(value, text)
    onChange(state)
    setFocusKey(key)
    requestAnimationFrame(() => textRefs.current.get(key)?.focus())
  }

  return (
    <div className="dv-layout">
      <ol className="dv-list" aria-label={`Aufbau: ${category.label}`}>
        {value.entries.map((e, i) => {
          const isText = e.kind === 'text'
          const isPayment = e.key === 'payment'
          const canMove = !e.fixed && !disabled
          return (
            <li
              key={e.key}
              className={`dv-row${e.hidden ? ' dv-row--hidden' : ''}${drag === i ? ' dv-row--drag' : ''}${isText ? ' dv-row--text' : ''}`}
              draggable={canMove}
              onDragStart={ev => { setDrag(i); ev.dataTransfer.effectAllowed = 'move' }}
              onDragOver={ev => { if (drag !== null && !e.fixed) ev.preventDefault() }}
              onDrop={ev => { ev.preventDefault(); if (drag !== null) onChange(moveEntry(value, drag, i)); setDrag(null) }}
              onDragEnd={() => setDrag(null)}
            >
              {e.pageBreak && <div className="dv-pagebreak" aria-hidden="true"><ScissorsLineDashed size={12} strokeWidth={2} /> Seitenumbruch</div>}
              <div className="dv-row-main">
                <span className={`dv-grip${canMove ? '' : ' dv-grip--off'}`} aria-hidden="true"><GripVertical size={14} strokeWidth={1.75} /></span>
                <span className="dv-row-label">
                  {e.label}
                  {e.locked && (
                    <span className="dv-lock" title={e.fixed ? 'Steht immer zuerst' : 'Pflichtangabe — verschiebbar, nicht ausblendbar'}>
                      <Lock size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">{e.fixed ? '(fest)' : '(Pflicht)'}</span>
                    </span>
                  )}
                  {e.hidden && <span className="dv-badge">ausgeblendet</span>}
                </span>
                <span className="dv-row-actions">
                  {isPayment && (
                    <select
                      className="dv-select"
                      aria-label="Zahlungshinweis"
                      value={value.payment}
                      disabled={disabled}
                      onChange={ev => onChange({ ...value, payment: ev.target.value as PaymentMode })}
                    >
                      {(Object.keys(PAYMENT_LABELS) as PaymentMode[]).map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                    </select>
                  )}
                  {!isPayment && !isText && !e.locked && (
                    <button
                      type="button"
                      className="row-action-btn"
                      aria-pressed={!e.hidden}
                      aria-label={e.hidden ? `${e.label} einblenden` : `${e.label} ausblenden`}
                      title={e.hidden ? 'Einblenden' : 'Ausblenden'}
                      disabled={disabled}
                      onClick={() => onChange(updateEntry(value, e.key, { hidden: !e.hidden }))}
                    >
                      {e.hidden ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                    </button>
                  )}
                  {!e.fixed && (
                    <button
                      type="button"
                      className={`row-action-btn${e.pageBreak ? ' dv-on' : ''}`}
                      aria-pressed={e.pageBreak}
                      aria-label={`Seitenumbruch vor ${e.label}`}
                      title="Seitenumbruch davor"
                      disabled={disabled}
                      onClick={() => onChange(updateEntry(value, e.key, { pageBreak: !e.pageBreak }))}
                    >
                      <ScissorsLineDashed size={14} strokeWidth={2} />
                    </button>
                  )}
                  {!e.fixed && (<>
                    <button type="button" className="row-action-btn" disabled={!canMove || i <= 1} onClick={() => onChange(moveEntry(value, i, i - 1))} aria-label={`${e.label} nach oben`}>
                      <ChevronUp size={14} strokeWidth={2} />
                    </button>
                    <button type="button" className="row-action-btn" disabled={!canMove || i === value.entries.length - 1} onClick={() => onChange(moveEntry(value, i, i + 1))} aria-label={`${e.label} nach unten`}>
                      <ChevronDown size={14} strokeWidth={2} />
                    </button>
                  </>)}
                  {isText && (
                    <button type="button" className="row-action-btn" disabled={disabled} onClick={() => onChange(removeEntry(value, e.key))} aria-label="Textblock entfernen" title="Textblock entfernen">
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  )}
                </span>
              </div>
              {isText && (
                <div className="dv-row-text">
                  <textarea
                    ref={el => { textRefs.current.set(e.key, el) }}
                    className="form-control"
                    rows={3}
                    maxLength={4000}
                    aria-label="Text des Textblocks"
                    placeholder="Text, der an dieser Stelle im Beleg erscheint. Leer = erscheint nicht."
                    value={e.text ?? ''}
                    disabled={disabled}
                    onFocus={() => setFocusKey(e.key)}
                    onChange={ev => onChange(updateEntry(value, e.key, { text: ev.target.value }))}
                  />
                  {focusKey === e.key && (
                    <PlaceholderChips
                      placeholders={placeholders}
                      category={category.key}
                      onInsert={tok => onChange(updateEntry(value, e.key, { text: insertAtCursor({ current: textRefs.current.get(e.key) ?? null }, e.text ?? '', tok) }))}
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="dv-layout-add">
        <button type="button" className="btn-small" disabled={disabled || value.entries.filter(e => e.kind === 'text').length >= 10} onClick={() => addBlock()}>
          <Plus size={13} strokeWidth={2} /> Textblock
        </button>
        {usable.length > 0 && (
          <select
            className="dv-select"
            aria-label="Textblock aus Textbaustein"
            value=""
            disabled={disabled}
            onChange={ev => { const s = usable.find(x => String(x.id) === ev.target.value); if (s) addBlock(s.text) }}
          >
            <option value="">Aus Textbaustein …</option>
            {usable.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <HelpHint id="vorlagen.aufbau" size={13} />
      </div>
      {hasPayment && value.payment === 'auto' && (
        <p className="dv-hint">Zahlungshinweis „Automatisch“: erscheint, solange der Beleg keinen Fußtext hat. <HelpHint id="vorlagen.zahlungshinweis" size={12} /></p>
      )}
    </div>
  )
}
