import { useMemo, useState } from 'react'
import { usePermissionsStore } from '@/store/permissionsStore'
import { ConsentGate } from './ConsentGate'
import { VorschlaegeTab } from './VorschlaegeTab'
import { FeedbackTab } from './FeedbackTab'
import { UnterstuetzungTab } from './UnterstuetzungTab'

type TabId = 'vorschlaege' | 'feedback' | 'unterstuetzung'

interface TabDef {
  id:         TabId
  label:      string
  permission: string
}

const ALL_TABS: TabDef[] = [
  { id: 'vorschlaege',    label: 'Vorschläge',    permission: 'service.suggestions.view' },
  { id: 'feedback',       label: 'Feedback',      permission: 'service.feedback.use' },
  { id: 'unterstuetzung', label: 'Unterstützung', permission: 'service.support.use' },
]

// ── Lokaler Segment-Umschalter (gleiches Muster wie MitarbeiterPage) ─────────
function SegmentNav<T extends string>({ items, active, onChange }: {
  items: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="seg-nav">
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          className={`seg-nav-btn${active === it.id ? ' active' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function ServicePage() {
  const keys = usePermissionsStore(s => s.keys)
  const unrestricted = usePermissionsStore(s => s.unrestricted)

  const tabs = useMemo(
    () => ALL_TABS.filter(t => unrestricted || keys.has(t.permission)),
    [keys, unrestricted],
  )
  const [active, setActive] = useState<TabId>(tabs[0]?.id ?? 'vorschlaege')
  const activeTab = tabs.some(t => t.id === active) ? active : (tabs[0]?.id ?? 'vorschlaege')

  return (
    <div className="page-root service-page">
      <div className="service-page-head">
        <h1>Service</h1>
        <p className="service-page-sub">Vorschläge, Feedback und Unterstützung — direkt an plan&amp;simple.</p>
      </div>

      <ConsentGate>
        {tabs.length > 1 && (
          <SegmentNav items={tabs.map(t => ({ id: t.id, label: t.label }))} active={activeTab} onChange={setActive} />
        )}
        {activeTab === 'vorschlaege'    && <VorschlaegeTab />}
        {activeTab === 'feedback'       && <FeedbackTab />}
        {activeTab === 'unterstuetzung' && <UnterstuetzungTab />}
      </ConsentGate>
    </div>
  )
}
