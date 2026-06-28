import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  X, ArrowDown, ArrowRight, HelpCircle,
  BookUser, FileSignature, FolderOpen, Receipt, type LucideIcon,
} from 'lucide-react'
import { BrandWordmark } from '@/components/brand/BrandLogo'
import { useSession } from '@/hooks/useSession'

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
  function dismiss() {
    setOpen(false)
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
  }
  if (open) return <WelcomePanel open onClose={dismiss} />
  return (
    <button type="button" className="welcome-panel-reopen" onClick={() => setOpen(true)}>
      <HelpCircle size={14} strokeWidth={2} /> Einführung anzeigen
    </button>
  )
}

/**
 * Orientierungs-Panel für neue Nutzer (erstes Login, dismissbar, über das
 * Dashboard wieder aufrufbar). Bewusst ruhig statt geführte Klick-Tour:
 * zeigt den durchgängigen Arbeitsablauf (Adresse → Angebot → Projekt →
 * Rechnung) als Einstiegs-Mentalmodell und verweist auf die Checkliste.
 * Die einzelnen Schritte sind anklickbar und führen direkt in den Bereich.
 */
const WORKFLOW: { icon: LucideIcon; label: string; sub: string; href: string }[] = [
  { icon: BookUser,      label: 'Adresse',  sub: 'Kunde anlegen',        href: '/adressen' },
  { icon: FileSignature, label: 'Angebot',  sub: 'daraus erstellen',     href: '/angebote' },
  { icon: FolderOpen,    label: 'Projekt',  sub: 'per Klick übernehmen',  href: '/projekte' },
  { icon: Receipt,       label: 'Rechnung', sub: 'aus dem Projekt',      href: '/rechnungen' },
]

export function WelcomePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          In plan&simple baut alles aufeinander auf: aus einer Adresse wird ein Angebot,
          daraus per Klick ein Projekt und daraus die Rechnung. So sieht dein Ablauf aus –
          du musst nichts doppelt erfassen.
        </p>
      </div>

      <div className="welcome-flow">
        {WORKFLOW.map((step, i) => {
          const Icon = step.icon
          return (
            <div className="welcome-flow-row" key={step.label}>
              <Link to={step.href} className="welcome-flow-step" onClick={onClose}>
                <span className="welcome-flow-num">{i + 1}</span>
                <span className="welcome-flow-icon"><Icon size={18} strokeWidth={1.75} /></span>
                <span className="welcome-flow-text">
                  <span className="welcome-flow-label">{step.label}</span>
                  <span className="welcome-flow-sub">{step.sub}</span>
                </span>
              </Link>
              {i < WORKFLOW.length - 1 && (
                <ArrowRight className="welcome-flow-arrow" size={16} strokeWidth={2} aria-hidden />
              )}
            </div>
          )
        })}
      </div>

      <div className="welcome-panel-foot">
        <span className="welcome-panel-hint">
          <ArrowDown size={14} strokeWidth={2} /> Dein Startpunkt: die Einrichtungs-Checkliste direkt darunter.
        </span>
        <button className="btn-primary btn-small" onClick={onClose}>Los geht&rsquo;s</button>
      </div>
    </div>
  )
}
