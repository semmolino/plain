import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, MessageSquare, Headset, Megaphone } from 'lucide-react'
import { usePermissionsStore, usePermission } from '@/store/permissionsStore'
import { HelpHint } from '@/components/ui/HelpHint'
import { InfoHint } from '@/components/ui/InfoHint'
import { ConsentGate } from './ConsentGate'
import { fetchDelegate, saveDelegate } from '@/api/service'
import { fetchEmployeeList } from '@/api/mitarbeiter'

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

// ── Platzhalter-Sektion (Phase 1/2 baut den echten Inhalt) ───────────────────
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

// ── Tab: Vorschläge (inkl. Produkt-Sprecher-Verwaltung für Admins) ───────────
function VorschlaegeTab() {
  const isAdmin = usePermission('service.suggestions.admin')

  return (
    <div className="service-tab">
      <div className="service-tab-head">
        <h2>Vorschläge für Funktionen</h2>
        <HelpHint id="service.vorschlaege" />
      </div>
      <p className="service-tab-lead">
        Wünschen Sie sich eine Funktion? Reichen Sie sie ein. Nach Prüfung durch plan&amp;simple erscheint
        sie im Portal, wo der Produkt-Sprecher Ihrer Organisation abstimmen kann. Andere Anwender sehen
        dabei niemals Ihren Namen oder Ihre Organisation.
      </p>

      {isAdmin && <DelegateCard />}

      <ComingSoon icon={<Lightbulb size={28} strokeWidth={1.5} />} title="Vorschlagsportal">
        Das Einreichen, Abstimmen und Verfolgen von Vorschlägen wird hier in Kürze verfügbar sein.
      </ComingSoon>
    </div>
  )
}

// ── Produkt-Sprecher festlegen (funktional, Phase 0) ─────────────────────────
function DelegateCard() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string>('')

  const delegateQuery = useQuery({ queryKey: ['service', 'delegate'], queryFn: () => fetchDelegate() })
  const employeesQuery = useQuery({
    queryKey: ['service', 'delegate', 'employees'],
    queryFn: () => fetchEmployeeList(),
    retry: false,           // bei fehlendem employees.view nicht endlos retryen
  })

  const save = useMutation({
    mutationFn: (empId: number | null) => saveDelegate(empId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', 'delegate'] })
      setSelected('')
    },
  })

  const employees = employeesQuery.data?.data ?? []
  const current = delegateQuery.data

  return (
    <div className="service-card">
      <div className="service-card-head">
        <Megaphone size={16} strokeWidth={1.75} />
        <strong>Produkt-Sprecher Ihrer Organisation</strong>
        <InfoHint title="Produkt-Sprecher" align="right">
          Damit nicht eine einzelne Organisation Wünsche überproportional hochstimmt, darf pro Organisation
          genau <strong>ein</strong> Mitarbeiter im Portal abstimmen und kommentieren. Alle anderen können
          Vorschläge weiterhin einsehen und einreichen.
        </InfoHint>
      </div>

      <p className="service-card-current">
        Aktuell:{' '}
        {current?.employee_name
          ? <strong>{current.employee_name}</strong>
          : <em>noch nicht festgelegt</em>}
      </p>

      {employeesQuery.isError ? (
        <p className="service-hint-muted">
          Zur Auswahl wird die Berechtigung „Mitarbeiter sehen" benötigt.
        </p>
      ) : (
        <div className="service-delegate-row">
          <select
            className="list-search"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{ maxWidth: 280 }}
          >
            <option value="">Mitarbeiter auswählen …</option>
            {employees.map(e => (
              <option key={e.ID} value={e.ID}>
                {e.NAME || `${e.FIRST_NAME} ${e.LAST_NAME}`.trim() || e.SHORT_NAME}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={!selected || save.isPending}
            onClick={() => save.mutate(Number(selected))}
          >
            Festlegen
          </button>
          {current?.employee_id != null && (
            <button
              type="button"
              className="btn-small"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Zurücksetzen
            </button>
          )}
        </div>
      )}
      {save.isError && <p className="consent-error">Speichern fehlgeschlagen. Bitte erneut versuchen.</p>}
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
