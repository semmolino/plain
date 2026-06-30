import { useMemo, useState } from 'react'
import { MessageSquare, Headset } from 'lucide-react'
import { usePermissionsStore } from '@/store/permissionsStore'
import { HelpHint } from '@/components/ui/HelpHint'
import { ConsentGate } from './ConsentGate'
import { VorschlaegeTab } from './VorschlaegeTab'

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

// ── Platzhalter-Sektion (Phase 2 baut den echten Inhalt) ─────────────────────
function ComingSoon({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="service-empty">
      <div className="service-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      <span className="service-empty-badge">In Vorbereitung</span>
    </div>
  )
}

function FeedbackTab() {
  return (
    <div className="service-tab">
      <div className="service-tab-head">
        <h2>Feedback &amp; Kontakt</h2>
        <HelpHint id="service.feedback" />
      </div>
      <p className="service-tab-lead">
        Lob, Kritik oder eine Frage? Schreiben Sie uns direkt. Ihre Angaben aus dem Login (Organisation,
        Name, E-Mail) werden im Formular vorbelegt. Ihre Nachricht geht ausschließlich an plan&amp;simple.
      </p>
      <ComingSoon icon={<MessageSquare size={28} strokeWidth={1.5} />} title="Kontaktformular">
        Das Feedback-Formular wird hier in Kürze verfügbar sein.
      </ComingSoon>
    </div>
  )
}

function UnterstuetzungTab() {
  return (
    <div className="service-tab">
      <div className="service-tab-head">
        <h2>Unterstützung anfragen</h2>
        <HelpHint id="service.unterstuetzung" />
      </div>
      <p className="service-tab-lead">
        Sie brauchen Hilfe bei einer konkreten Aufgabe — etwa bei der Übernahme Ihrer Altdaten? Wählen Sie
        eine Kategorie und schildern Sie Ihr Anliegen. Häufige Fragen beantworten wir vorab direkt hier.
      </p>
      <ComingSoon icon={<Headset size={28} strokeWidth={1.5} />} title="Hilfe & FAQ">
        Kategorien, FAQ und das Anfrageformular werden hier in Kürze verfügbar sein.
      </ComingSoon>
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
