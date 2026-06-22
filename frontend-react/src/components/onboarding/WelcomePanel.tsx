import { useState } from 'react'
import {
  X, ArrowDown, HelpCircle,
  LayoutDashboard, BookUser, FileSignature, FolderOpen,
  Receipt, BarChart3, Users, Settings, type LucideIcon,
} from 'lucide-react'
import { BrandWordmark } from '@/components/brand/BrandLogo'
import { useSession } from '@/hooks/useSession'
import { QuickstartOfferModal } from './QuickstartOfferModal'

const WELCOME_KEY = 'plansimple.welcome_dismissed'

/**
 * Stateful Wrapper fürs Dashboard: zeigt das Orientierungs-Panel bis es pro
 * Organisation weggeklickt wurde; danach bleibt ein dezenter „Einführung
 * anzeigen"-Button zum erneuten Aufruf.
 */
export function WelcomeSection() {
  const { tenantId } = useSession()
  const key = `${WELCOME_KEY}_${tenantId ?? 'anon'}`
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(key) !== '1' } catch { return true }
  })
  const [quickOpen, setQuickOpen] = useState(false)
  function dismiss() {
    setOpen(false)
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
  }
  return (
    <>
      {open ? (
        <WelcomePanel open onClose={dismiss} onQuickstart={() => setQuickOpen(true)} />
      ) : (
        <button type="button" className="welcome-panel-reopen" onClick={() => setOpen(true)}>
          <HelpCircle size={14} strokeWidth={2} /> Einführung anzeigen
        </button>
      )}
      <QuickstartOfferModal open={quickOpen} onClose={() => setQuickOpen(false)} />
    </>
  )
}

/**
 * Orientierungs-Panel für neue Nutzer (erstes Login, dismissbar, über das
 * Dashboard wieder aufrufbar). Bewusst ruhig statt geführte Klick-Tour:
 * erklärt den Aufbau + Nutzen und verweist auf die Einrichtungs-Checkliste.
 */
const AREAS: { icon: LucideIcon; label: string; desc: string }[] = [
  { icon: LayoutDashboard, label: 'Übersicht',     desc: 'Kennzahlen & offene Aufgaben auf einen Blick' },
  { icon: BookUser,        label: 'Adressen',      desc: 'Kunden & Kontakte — Basis für Angebote und Rechnungen' },
  { icon: FileSignature,   label: 'Angebote',      desc: 'HOAI- oder Pauschal-Angebote, per Klick zum Projekt' },
  { icon: FolderOpen,      label: 'Projekte',      desc: 'Struktur, Budget, Leistungsstand, Stunden' },
  { icon: Receipt,         label: 'Rechnungen',    desc: 'Abschlags-, Schluss- & Einzelrechnungen, E-Rechnung' },
  { icon: BarChart3,       label: 'Reporting',     desc: 'Auswertungen zu Projekten & Mitarbeitern' },
  { icon: Users,           label: 'Mitarbeiter',   desc: 'Team, Rollen, Stunden, Kostensätze' },
  { icon: Settings,        label: 'Einstellungen', desc: 'Unternehmen, Nummernkreise, Vorbelegungen …' },
]

export function WelcomePanel({ open, onClose, onQuickstart }: { open: boolean; onClose: () => void; onQuickstart: () => void }) {
  if (!open) return null
  return (
    <div className="welcome-panel">
      <button className="welcome-panel-close" onClick={onClose} aria-label="Einführung schließen">
        <X size={18} strokeWidth={2} />
      </button>

      <div className="welcome-panel-head">
        <BrandWordmark size={28} />
        <h2 className="welcome-panel-title">Willkommen!</h2>
        <p className="welcome-panel-lead">
          plan&simple bildet deinen Büroalltag an einem Ort ab — von der ersten Adresse über Angebot
          und Projekt bis zur Rechnung. Hier eine kurze Orientierung; danach führt dich die
          Einrichtungs-Checkliste Schritt für Schritt.
        </p>
      </div>

      <div className="welcome-panel-grid">
        {AREAS.map(a => {
          const Icon = a.icon
          return (
            <div className="welcome-area" key={a.label}>
              <span className="welcome-area-icon"><Icon size={18} strokeWidth={1.75} /></span>
              <div>
                <div className="welcome-area-label">{a.label}</div>
                <div className="welcome-area-desc">{a.desc}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="welcome-panel-foot">
        <span className="welcome-panel-hint">
          <ArrowDown size={14} strokeWidth={2} /> Oder die Einrichtungs-Checkliste direkt darunter.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-small" onClick={onClose}>Später</button>
          <button className="btn-primary btn-small" onClick={onQuickstart}>Schnellstart: erstes Angebot</button>
        </div>
      </div>
    </div>
  )
}
