import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { LayoutEditor } from '@/components/vorlagen/LayoutEditor'
import { AppendixEditor } from '@/components/vorlagen/AppendixEditor'
import { chainOf, differs, effectiveLayout, templateLevels, toOverride, type LayoutState } from '@/components/vorlagen/layoutModel'
import { DEFAULT_THEME, type DocCatalog, type DocTheme, type ThemeBlocks } from '@/api/documentTemplates'
import type { DocumentText } from '@/api/documentTexts'

/** Hat die Kategorie in der Vorlage eine eigene Einstellung (Aufbau oder Anhänge)? */
function isCustomized(theme: DocTheme, catalog: DocCatalog, key: string): boolean {
  if (theme.bodyByCategory?.[key]) return true
  const cat = catalog.categories.find(c => c.key === key)
  if (!cat?.appendices.length) return false
  const own = theme.blocksByCategory?.[key]
  if (!own) return false
  const ref = cat.parent ? appendixSource(theme, catalog, cat.parent) : DEFAULT_THEME.blocks
  return cat.appendices.some(a => (own[a.key] !== false) !== (ref?.[a.key] !== false))
    || JSON.stringify(orderOf(own, cat.appendices.map(a => a.key))) !== JSON.stringify(orderOf(ref, cat.appendices.map(a => a.key)))
}

const orderOf = (b: ThemeBlocks | undefined, keys: string[]) => {
  const ord = Array.isArray(b?.order) ? b!.order.filter(k => keys.includes(k)) : []
  return [...ord, ...keys.filter(k => !ord.includes(k))]
}

/** Anhänge wie am Server: die erste Kategorie der Kette mit eigener Einstellung. */
function appendixSource(theme: DocTheme, catalog: DocCatalog, key: string): ThemeBlocks | undefined {
  for (const c of chainOf(catalog.categories, key)) if (theme.blocksByCategory?.[c.key]) return theme.blocksByCategory[c.key]
  return undefined
}

export function AufbauPanel({ theme, onChange, catalog, category, onCategory, snippets }: {
  theme:      DocTheme
  onChange:   (fn: (t: DocTheme) => DocTheme) => void
  catalog:    DocCatalog
  category:   string
  onCategory: (key: string) => void
  snippets:   DocumentText[]
}) {
  const cat = catalog.categories.find(c => c.key === category) ?? catalog.categories[0]
  const parent = cat.parent ? catalog.categories.find(c => c.key === cat.parent) : undefined

  const base = useMemo(
    () => effectiveLayout(cat, templateLevels(catalog.categories, cat.key, theme.bodyByCategory, false)),
    [cat, catalog.categories, theme.bodyByCategory],
  )
  const state = useMemo(
    () => effectiveLayout(cat, templateLevels(catalog.categories, cat.key, theme.bodyByCategory)),
    [cat, catalog.categories, theme.bodyByCategory],
  )

  function setLayout(next: LayoutState) {
    onChange(t => {
      const body = { ...(t.bodyByCategory ?? {}) }
      // Gleich dem Stand darunter: keine eigene Einstellung — dann erbt die
      // Belegart auch spätere Änderungen der übergeordneten.
      if (differs(next, base)) body[cat.key] = toOverride(next, base)
      else delete body[cat.key]
      return { ...t, bodyByCategory: body }
    })
  }

  const appendixValue = appendixSource(theme, catalog, cat.key) ?? DEFAULT_THEME.blocks
  function setAppendices(next: ThemeBlocks) {
    onChange(t => ({ ...t, blocksByCategory: { ...(t.blocksByCategory ?? {}), [cat.key]: next } }))
  }

  function reset() {
    onChange(t => {
      const body = { ...(t.bodyByCategory ?? {}) }
      delete body[cat.key]
      const blocks = { ...(t.blocksByCategory ?? {}) }
      if (cat.parent || !cat.appendices.length) delete blocks[cat.key]
      else blocks[cat.key] = { ...DEFAULT_THEME.blocks }
      return { ...t, bodyByCategory: body, blocksByCategory: blocks }
    })
  }

  const customized = isCustomized(theme, catalog, cat.key)
  const textType = catalog.textTypes.find(t => t.category === cat.key)

  return (
    <>
      <div className="dv-cat">
        <div className="form-group">
          <label htmlFor="dv-cat">Belegart</label>
          <select id="dv-cat" value={cat.key} onChange={e => onCategory(e.target.value)}>
            {catalog.categories.map(c => (
              <option key={c.key} value={c.key}>{c.label}{isCustomized(theme, catalog, c.key) ? ' — angepasst' : ''}</option>
            ))}
          </select>
        </div>
        <p className="dv-cat-state">
          {customized ? 'Eigene Einstellung.'
            : parent ? <>Übernimmt die Einstellung der {parent.label}. <HelpHint id="vorlagen.erben" size={12} /></>
            : 'Standard.'}
          {customized && (
            <button type="button" className="btn-small" onClick={reset}>
              <RotateCcw size={13} strokeWidth={2} /> {parent ? `Wie ${parent.label}` : 'Auf Standard zurücksetzen'}
            </button>
          )}
        </p>
      </div>

      <FormSection title="Hauptteil" help="vorlagen.aufbau" layout="block"
        hint="Reihenfolge per Ziehen oder Pfeil. Bausteine mit Schloss tragen Pflichtangaben und bleiben sichtbar.">
        <LayoutEditor category={cat} value={state} onChange={setLayout} placeholders={catalog.placeholders} snippets={snippets} />
      </FormSection>

      {cat.appendices.length > 0 && (
        <FormSection title="Anhänge" help="vorlagen.anhaenge" layout="block"
          hint="Eigene Seiten nach dem Beleg. Ein Anhang erscheint nur, wenn er an ist und Daten dafür vorliegen.">
          <AppendixEditor appendices={cat.appendices} value={appendixValue} onChange={setAppendices} />
        </FormSection>
      )}

      <p className="dv-hint">
        {cat.key === 'mahnung'
          ? <>Die Texte der Mahnstufen stehen unter&nbsp;<Link to="/admin?tab=mahnungseinstellungen">Einstellungen → Mahnungen</Link></>
          : textType
            ? <>Kopf- und Fußtext stehen unter&nbsp;<Link to={`/admin?tab=dokumentvorlagen&sub=texte&type=${textType.type}`}>Texte → {textType.label}</Link></>
            : null}
      </p>
    </>
  )
}
