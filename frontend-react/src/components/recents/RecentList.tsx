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

const TYPE_DEFAULT_PATH: Record<RecentEntityType, (id: number) => string> = {
  project:                     (id) => `/projekte?tab=buchungen&projectId=${id}`,
  invoice:                     (id) => `/rechnungen?selected=${id}`,
  partial_payment:             (id) => `/rechnungen?pp=${id}`,
  offer:                       (id) => `/angebote?selected=${id}`,
  mahnung:                     (id) => `/rechnungen?mahnung=${id}`,
  address:                     (id) => `/adressen?selected=${id}`,
  project_structure:           ()   => '/projekte',
  report_filter:               ()   => '/daten',
  report_projektliste_filter:  ()   => '/daten',
  report_trends_filter:        ()   => '/daten',
  report_kennzahlen_filter:    ()   => '/daten',
  mitarbeiter_report_filter:   ()   => '/mitarbeiter',
}

const TYPE_LABEL: Record<RecentEntityType, string> = {
  project:                     'Projekt',
  invoice:                     'Rechnung',
  partial_payment:             'Abschlag',
  offer:                       'Angebot',
  mahnung:                     'Mahnung',
  address:                     'Adresse',
  project_structure:           'Position',
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
    else          navigate(TYPE_DEFAULT_PATH[type](entry.ENTITY_ID))
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

/** Dashboard-Variante: typuebergreifender Mix mit kleinen Type-Badges. */
export function RecentMixedList({ limit = 8 }: { limit?: number }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['recents', 'dashboard'],
    queryFn:  () => fetchDashboardRecents(limit),
    staleTime: 30_000,
  })

  const items = data?.data ?? []
  if (!isLoading && items.length === 0) return null

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
              onClick={() => navigate(TYPE_DEFAULT_PATH[e.ENTITY_TYPE](e.ENTITY_ID))}
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
