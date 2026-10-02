import { familyOf, type PlaceholderInfo } from '@/api/documentTemplates'
import { HelpHint } from '@/components/ui/HelpHint'

/**
 * Platzhalter zum Einfügen an der Cursorposition. Die Liste kommt vom Server
 * (documentPlaceholders.js); gezeigt wird nur, was in der Belegart einen Wert
 * hat — `{{leistungszeitraum}}` im Angebot bliebe leer.
 */
export function PlaceholderChips({ placeholders, category, onInsert }: {
  placeholders: PlaceholderInfo[]
  /** Belegkategorie; ohne = alle Platzhalter */
  category?:    string | null
  onInsert:     (token: string) => void
}) {
  const fam = category ? familyOf(category) : null
  const list = placeholders.filter(p => !fam || !p.scope || p.scope.includes(fam))
  if (!list.length) return null
  return (
    <div className="dv-chips" role="group" aria-label="Platzhalter einfügen">
      <span className="dv-chips-label">Platzhalter<HelpHint id="vorlagen.platzhalter" size={12} /></span>
      {list.map(p => (
        <button
          key={p.token}
          type="button"
          className="dv-chip"
          // Fokus bleibt im Textfeld, damit die Cursorposition erhalten bleibt
          onMouseDown={e => e.preventDefault()}
          onClick={() => onInsert(`{{${p.token}}}`)}
          title={`{{${p.token}}}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

