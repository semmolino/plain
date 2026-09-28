import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Fehlerseite der Wurzel-Route (Data-Router, UI-Pilot Runde 2).
 *
 * Faengt, was an den ErrorBoundaries innerhalb der Seiten vorbeigeht —
 * Fehler im Router selbst, beim Laden einer Seite (lazy import nach einem
 * Deploy: die alte Datei gibt es nicht mehr) oder in einem Navigationsblock.
 * Statt eines Stacktraces sagt sie, was man tun kann; der technische Text
 * steht aufklappbar darunter, fuer die Fehlermeldung an den Support.
 */
export function RouteError() {
  const err = useRouteError()
  const detail = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error ? err.message : String(err)
  const chunk = /dynamically imported module|Loading chunk|Failed to fetch/i.test(detail)
  return (
    <div className="route-error" role="alert">
      <AlertTriangle size={28} strokeWidth={1.75} aria-hidden="true" />
      <h1>{chunk ? 'plan&simple wurde aktualisiert' : 'Diese Seite konnte nicht geladen werden'}</h1>
      <p>
        {chunk
          ? 'Seit dem Öffnen gibt es eine neue Version. Einmal neu laden, dann geht es weiter.'
          : 'Ein Fehler hat die Seite angehalten. Neu laden hilft meistens; Eingaben, die noch nicht gespeichert waren, sind dabei verloren.'}
      </p>
      <div className="route-error-actions">
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" /> Neu laden
        </button>
        <a className="btn-secondary" href="/">Zur Übersicht</a>
      </div>
      <details className="route-error-detail">
        <summary>Technische Angaben</summary>
        <pre>{detail}</pre>
      </details>
    </div>
  )
}
