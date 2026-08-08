interface TableSkeletonProps {
  /** Anzahl der Spalten — sollte der echten Tabelle entsprechen. */
  columns: number
  /** Anzahl der Platzhalterzeilen. Default 6: fuellt den sichtbaren Bereich,
      ohne bei kurzen Listen einen zu grossen Sprung nach unten zu erzeugen. */
  rows?: number
}

/**
 * Platzhalter waehrend eine Liste laedt.
 *
 * Vorher stand dort eine 13px-Zeile „Laden …" links oben in einer rund
 * 500px hohen leeren Flaeche — gemessen auf /projekte und /rechnungen.
 * Das sagt weder, dass gleich eine Tabelle kommt, noch wie umfangreich sie
 * wird.
 *
 * Der Platzhalter traegt `aria-hidden`: fuer Screenreader ist eine Reihe
 * leerer Kaesten nutzlos. Die Ansage uebernimmt die Statuszeile im
 * umgebenden `<div role="status">` (siehe ListLoading).
 */
export function TableSkeleton({ columns, rows = 6 }: TableSkeletonProps) {
  // Unterschiedliche Breiten, damit es nach Text aussieht und nicht nach
  // einem Raster. Feste Folge statt Zufall — sonst flackert es bei jedem
  // Render neu.
  const widths = ['70%', '45%', '85%', '55%', '75%', '40%', '65%', '50%']

  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <span className="skeleton skeleton-cell" key={c}
              style={{ width: widths[(r * columns + c) % widths.length] }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Ladezustand einer Liste: Platzhaltertabelle plus Ansage fuer Screenreader.
 * `role="status"` meldet den Wechsel von „laedt" zu „fertig", ohne den Fokus
 * zu stehlen.
 */
export function ListLoading({ columns, rows }: TableSkeletonProps) {
  return (
    <div role="status" aria-busy="true" className="list-loading">
      <span className="sr-only">Liste wird geladen …</span>
      <TableSkeleton columns={columns} rows={rows} />
    </div>
  )
}

/**
 * Ladezustand der Uebersicht: Kennzahlkacheln plus eine Platzhaltertabelle.
 *
 * Vorher stand dort ein zentriertes „Laden …" in rund 180px leerer Flaeche,
 * darunter nichts. Die Kacheln greifen das kommende Raster vorweg
 * (`.kpi-grid` — zwei Spalten, ab Tablet vier).
 */
export function DashboardLoading({ cards = 4 }: { cards?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Übersicht wird geladen …</span>
      <div className="kpi-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <div className="kpi-card" key={i}>
            <span className="skeleton" style={{ width: '55%', height: 11, display: 'block' }} />
            <span className="skeleton" style={{ width: '70%', height: 24, display: 'block', marginTop: 10 }} />
          </div>
        ))}
      </div>
      <TableSkeleton columns={5} rows={4} />
    </div>
  )
}

/**
 * Einzelner Platzhalterbalken fuer Kacheln und Detailbereiche.
 * `width`/`height` als CSS-Werte, z. B. "60%" oder 32.
 */
export function SkeletonBar({ width = '100%', height = 14 }: { width?: string | number; height?: string | number }) {
  return <span className="skeleton" style={{ width, height, display: 'block' }} aria-hidden="true" />
}
