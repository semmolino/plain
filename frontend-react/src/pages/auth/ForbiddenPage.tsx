import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

export function ForbiddenPage() {
  const navigate = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from

  return (
    <div style={{
      minHeight: 'calc(100vh - 120px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 24, textAlign: 'center',
    }}>
      <ShieldAlert size={64} strokeWidth={1.5} color="#dc2626" />
      <h1 style={{ fontSize: 'var(--fs-page-title)', fontWeight: 'var(--fw-title)', margin: 0 }}>Keine Berechtigung</h1>
      <p style={{ fontSize: 14, color: '#6b7280', margin: 0, maxWidth: 420 }}>
        {from ? <>Du hast keinen Zugriff auf <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{from}</code>.<br/></> : null}
        Falls du der Meinung bist, dass du dies sehen solltest, wende dich an deinen Administrator.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-secondary" onClick={() => navigate(-1)}>Zurück</button>
        <Link to="/" className="btn-primary">Zur Übersicht</Link>
      </div>
    </div>
  )
}
