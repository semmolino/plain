import type { ReactNode } from 'react'

interface SortThProps<K extends string> {
  /** Beschriftung der Spalte. */
  label: ReactNode
  /** Sortierschlüssel dieser Spalte. */
  column: K
  /** Aktuell sortierte Spalte. */
  sortKey: K
  /** Aktuelle Richtung. */
  dir: 'asc' | 'desc'
  /** Klick/Tastendruck auf den Kopf. */
  onSort: (k: K) => void
  /** Zusätzliche Klasse, z. B. `num` für rechtsbündige Zahlenspalten. */
  className?: string
}

/**
 * Sortierbarer Spaltenkopf — eine Komponente für alle Listen.
 *
 * Das Muster lag zuletzt in neun Kopien im Code, mit drei verschiedenen
 * Prop-Namen für dasselbe und jeweils eigenem (bzw. fehlendem) Tastatur- und
 * ARIA-Verhalten. Neue Listen beziehen den Kopf hier (siehe CLAUDE.md,
 * „Gemeinsame Komponente, nicht kopieren").
 *
 * Über die Kopie hinaus: `aria-sort` meldet Screenreadern die aktive Spalte
 * und Richtung, und der Kopf ist per Tab erreichbar sowie mit Enter/Leertaste
 * bedienbar — vorher war Sortieren reine Mausfunktion.
 */
export function SortTh<K extends string>({ label, column, sortKey, dir, onSort, className }: SortThProps<K>) {
  const active = sortKey === column
  return (
    <th
      scope="col"
      // `useFitColumns` misst die Spaltenbreiten ueber dieses Attribut, um
      // ausrechnen zu koennen, wie viele Spalten weichen muessen.
      data-col={column}
      className={['sortable-th', className].filter(Boolean).join(' ')}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      tabIndex={0}
      onClick={() => onSort(column)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(column) }
      }}
    >
      {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}
