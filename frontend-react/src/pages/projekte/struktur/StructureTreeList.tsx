import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { money, fmtEur } from '@/utils/money'

export interface TreeListItem {
  id:       number
  fatherId: number | null
  depth:    number
  abbr:     string
  name:     string
  isParent: boolean
  /** Honorar vor Zuschlaegen (klein, grau) */
  fee:      number
  /** Gesamt inkl. Zuschlaegen und Nebenkosten */
  total:    number
  muted?:   boolean
}

/**
 * Baumliste am Handy (Projekt- und Angebotsstruktur): Element, Honorar,
 * Gesamt; Vaeter lassen sich auf- und zuklappen, ein Tipp auf die Zeile
 * oeffnet das Element. Das Blatt dazu bringt jede Struktur selbst mit, weil
 * sich die Felder unterscheiden (Buchungen vs. Stunden × Satz).
 */
export function StructureTreeList({ items, root, listLabel, canEdit, onOpen }: {
  items:     TreeListItem[]
  root:      { label: string; total: number } | null
  listLabel: string
  canEdit:   boolean
  onOpen:    (id: number) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const parentOf = useMemo(() => new Map(items.map(i => [i.id, i.fatherId])), [items])
  const hidden = (id: number) => {
    let cur = parentOf.get(id)
    while (cur != null) { if (collapsed.has(Number(cur))) return true; cur = parentOf.get(Number(cur)) }
    return false
  }
  const toggle = (id: number) => setCollapsed(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      {root && (
        <div className="sxm-root">
          <span className="sxm-root-label">{root.label}</span>
          <span>{money(root.total)}</span>
        </div>
      )}
      <ul className="sxm-list" aria-label={listLabel}>
        {items.filter(i => !hidden(i.id)).map(i => {
          const isOpen = !collapsed.has(i.id)
          return (
            <li key={i.id} className={`sxm-row${i.isParent ? ' sxm-row--parent' : ''}${i.muted ? ' sxm-row--internal' : ''}`}
              style={{ paddingLeft: `calc(var(--space-2) + ${i.depth} * 14px)` }}>
              {i.isParent ? (
                <button type="button" className="sxm-twisty" aria-expanded={isOpen}
                  aria-label={`${i.abbr} ${isOpen ? 'zuklappen' : 'aufklappen'}`} onClick={() => toggle(i.id)}>
                  <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : <span className="sxm-twisty-space" aria-hidden="true" />}
              <button type="button" className="sxm-open" onClick={() => onOpen(i.id)}
                aria-label={`${i.abbr} ${i.name} ${canEdit ? 'bearbeiten' : 'ansehen'}`}>
                <span className="sxm-el">
                  <span className="sxm-abbr">{i.abbr}</span>
                  <span className="sxm-name">{i.name}</span>
                </span>
                <span className="sxm-nums">
                  <span className="sxm-fee">{fmtEur(i.fee)}</span>
                  <span className="sxm-total">{money(i.total)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
