import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Clock, TrendingUp } from 'lucide-react'
import { fetchRecents, fetchDashboardRecents, type RecentEntityType, type RecentEntry, type RecentSortBy } from '@/api/recents'

interface SingleProps {
  type:      RecentEntityType
  limit?:    number
  title?:    string
  onSelect?: (entry: RecentEntry) => void   // Optionaler Override; sonst Navigations-Default
  emptyHint?: string
  className?: string
  /** Fuer kontextabhaengige Typen wie project_structure: schraenkt die Liste
   *  auf Eintraege ein, deren META.project_id zu diesem Wert passt. */
  projectId?: number | null
  /** Blendet den 'Zuletzt | Haeufig'-Toggle aus. Default: an. */
  hideSortToggle?: boolean
}

type Target = { to: string; state?: unknown }
const meta = (e: RecentEntry) => (e.META ?? {}) as Record<string, unknown>
// Nummer aus dem META, sonst der erste Teil der Beschriftung („RE-2026-0052 · Stadt …").
const numberOf = (e: RecentEntry) => String(meta(e).number ?? (e.LABEL ?? '').split(' · ')[0] ?? '')

/**
 * Wohin ein Eintrag fuehrt (UI-Pilot 2026-09).
 *
 * Vorher zeigten fuenf von sechs Zielen auf Query-Parameter, die keine Seite
 * auswertete (`?selected=`, `?pp=`, `?mahnung=`) — der Klick landete auf der
 * Liste, ohne den Datensatz. Jetzt geht es ueber das, was die Seiten heute
 * schon lesen: `location.state` bzw. die URL des Projekt-Arbeitsbereichs.
 */
const TARGET: Record<RecentEntityType, (e: RecentEntry) => Target> = {
  project:                     (e) => ({ to: `/projekte?projectId=${e.ENTITY_ID}&tab=struktur` }),
  invoice:                     (e) => ({ to: '/rechnungen', state: { projectSearch: numberOf(e) } }),
  partial_payment:             (e) => ({ to: '/rechnungen', state: { projectSearch: numberOf(e) } }),
  offer:                       (e) => ({ to: '/angebote',   state: { tab: 'struktur', offerId: e.ENTITY_ID } }),
  mahnung:                     (e) => {
    const sourceType = meta(e).source_type
    return typeof sourceType === 'string'
      ? { to: '/rechnungen', state: { tab: 'mahnungen', openMahnung: { sourceType, sourceId: e.ENTITY_ID } } }
      : { to: '/rechnungen?tab=mahnungen' }
  },
  address:                     (e) => ({ to: '/adressen', state: { openAddressId: e.ENTITY_ID } }),
  project_structure:           (e) => meta(e).project_id != null
    ? { to: `/projekte?projectId=${Number(meta(e).project_id)}&tab=buchungen` }
    : { to: '/projekte' },
  fee_master:                  ()   => ({ to: '/projekte?tab=honorar' }),
  report_filter:               ()   => ({ to: '/daten' }),
  report_projektliste_filter:  ()   => ({ to: '/daten' }),
  report_trends_filter:        ()   => ({ to: '/daten' }),
  report_kennzahlen_filter:    ()   => ({ to: '/daten' }),
  mitarbeiter_report_filter:   ()   => ({ to: '/mitarbeiter' }),
}

const TYPE_LABEL: Record<RecentEntityType, string> = {
  project:                     'Projekt',
  invoice:                     'Rechnung',
  partial_payment:             'Abschlag',
  offer:                       'Angebot',
  mahnung:                     'Mahnung',
  address:                     'Adresse',
  project_structure:           'Position',
  fee_master:                  'Leistungsbild',
  report_filter:               'Filter',
  report_projektliste_filter:  'Filter',
  report_trends_filter:        'Filter',
  report_kennzahlen_filter:    'Filter',
  mitarbeiter_report_filter:   'Filter',
}

/** Liste zuletzt verwendeter Datensaetze pro Entity-Typ. */
export function RecentList({ type, limit = 5, title, onSelect, emptyHint, className, projectId, hideSortToggle }: SingleProps) {
  const navigate = useNavigate()
  const [sortBy, setSortBy] = useState<RecentSortBy>('recent')
  const { data, isLoading } = useQuery({
    queryKey: ['recents', type, projectId ?? null, sortBy],
    queryFn:  () => fetchRecents(type, limit, { projectId, sortBy }),
    staleTime: 30_000,
  })

  const items = data?.data ?? []
  if (!isLoading && items.length === 0 && !emptyHint) return null

  function handleClick(entry: RecentEntry) {
    if (onSelect) onSelect(entry)
    else {
      const t = TARGET[type](entry)
      navigate(t.to, { state: t.state })
    }
  }

  return (
    <div className={`recent-list-card ${className ?? ''}`.trim()}>
      <div className="recent-list-header">
        <div className="recent-list-title">
          {sortBy === 'recent' ? <Clock size={13} strokeWidth={2} /> : <TrendingUp size={13} strokeWidth={2} />}
          {' '}{title ?? (sortBy === 'recent' ? 'Zuletzt verwendet' : 'Häufig verwendet')}
        </div>
        {!hideSortToggle && (
          <div className="recent-list-toggle">
            <button
              className={`recent-list-toggle-btn${sortBy === 'recent' ? ' active' : ''}`}
              onClick={() => setSortBy('recent')}
              title="Zuletzt verwendet"
            >Zuletzt</button>
            <button
              className={`recent-list-toggle-btn${sortBy === 'frequent' ? ' active' : ''}`}
              onClick={() => setSortBy('frequent')}
              title="Häufig verwendet"
            >Häufig</button>
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="recent-list-empty">Laden …</div>
      ) : items.length === 0 ? (
        <div className="recent-list-empty">{emptyHint}</div>
      ) : (
        <div className="recent-list-chips">
          {items.map(e => (
            <button
              key={e.ID}
              className="recent-chip"
              onClick={() => handleClick(e)}
              title={`${TYPE_LABEL[e.ENTITY_TYPE]} – ${new Date(e.LAST_SEEN).toLocaleString('de-DE')} · ${e.VIEW_COUNT}×`}
            >
              {e.LABEL || `${TYPE_LABEL[e.ENTITY_TYPE]} #${e.ENTITY_ID}`}
              {sortBy === 'frequent' && <span className="recent-chip-count"> · {e.VIEW_COUNT}×</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Dashboard-Variante: typuebergreifender Mix mit kleinen Type-Badges.
 *  `variant="list"`: kompakte Liste fuer das obere Band der Uebersicht. */
export function RecentMixedList({ limit = 8, variant = 'grid' }: { limit?: number; variant?: 'grid' | 'list' }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['recents', 'dashboard'],
    queryFn:  () => fetchDashboardRecents(8),
    staleTime: 30_000,
  })

  const items = (data?.data ?? []).slice(0, limit)
  if (!isLoading && items.length === 0) return null

  function go(e: RecentEntry) {
    const t = TARGET[e.ENTITY_TYPE](e)
    navigate(t.to, { state: t.state })
  }

  if (variant === 'list') {
    return (
      <section className="dash-band-card recent-compact" aria-labelledby="recent-compact-title">
        <h2 className="dash-band-title" id="recent-compact-title">Schnellzugriff</h2>
        {isLoading ? (
          <div className="recent-list-empty">Laden …</div>
        ) : (
          <ul className="recent-compact-list">
            {items.map(e => (
              <li key={e.ID}>
                <button type="button" className="recent-compact-row" onClick={() => go(e)} title={e.LABEL ?? undefined}>
                  <span className="recent-compact-type">{TYPE_LABEL[e.ENTITY_TYPE]}</span>
                  <span className="recent-compact-label">{e.LABEL || `#${e.ENTITY_ID}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="recent-list-card recent-list-card-dashboard">
      <div className="recent-list-title">
        <Clock size={14} strokeWidth={2} /> Schnellzugriff — zuletzt verwendet
      </div>
      {isLoading ? (
        <div className="recent-list-empty">Laden …</div>
      ) : (
        <div className="recent-mixed-grid">
          {items.map(e => (
            <button
              key={e.ID}
              className="recent-mixed-card"
              onClick={() => go(e)}
            >
              <div className="recent-mixed-type">{TYPE_LABEL[e.ENTITY_TYPE]}</div>
              <div className="recent-mixed-label">{e.LABEL || `#${e.ENTITY_ID}`}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
