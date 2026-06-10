import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { fetchRecents, fetchDashboardRecents, type RecentEntityType, type RecentEntry } from '@/api/recents'

interface SingleProps {
  type:      RecentEntityType
  limit?:    number
  title?:    string
  onSelect?: (entry: RecentEntry) => void   // Optionaler Override; sonst Navigations-Default
  emptyHint?: string
  className?: string
}

const TYPE_DEFAULT_PATH: Record<RecentEntityType, (id: number) => string> = {
  project:         (id) => `/projekte?selected=${id}`,
  invoice:         (id) => `/rechnungen?selected=${id}`,
  partial_payment: (id) => `/rechnungen?pp=${id}`,
  offer:           (id) => `/angebote?selected=${id}`,
  mahnung:         (id) => `/rechnungen?mahnung=${id}`,
  address:         (id) => `/adressen?selected=${id}`,
}

const TYPE_LABEL: Record<RecentEntityType, string> = {
  project:         'Projekt',
  invoice:         'Rechnung',
  partial_payment: 'Abschlag',
  offer:           'Angebot',
  mahnung:         'Mahnung',
  address:         'Adresse',
}

/** Liste zuletzt verwendeter Datensaetze pro Entity-Typ. */
export function RecentList({ type, limit = 5, title, onSelect, emptyHint, className }: SingleProps) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['recents', type],
    queryFn:  () => fetchRecents(type, limit),
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
      <div className="recent-list-title">
        <Clock size={13} strokeWidth={2} /> {title ?? 'Zuletzt verwendet'}
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
              title={`${TYPE_LABEL[e.ENTITY_TYPE]} – ${new Date(e.LAST_SEEN).toLocaleString('de-DE')}`}
            >
              {e.LABEL || `${TYPE_LABEL[e.ENTITY_TYPE]} #${e.ENTITY_ID}`}
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
