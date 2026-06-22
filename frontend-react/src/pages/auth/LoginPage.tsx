import { useState, useEffect, type KeyboardEvent } from 'react'
import { BranchIllustrationForTheme } from '@/components/theme/BranchIllustrations'
import { getThemePhoto } from '@/config/themePhotos'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { loginEmployee, requestPasswordReset } from '@/api/auth'
import { fetchPublicLoginBranding } from '@/api/tenants'
import { useAuthStore } from '@/store/authStore'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import { BrandWordmark } from '@/components/brand/BrandLogo'

const SLUG_CACHE_KEY = 'plain.last-tenant-slug'

export function LoginPage() {
  const navigate  = useNavigate()
  const setAuth   = useAuthStore(s => s.setAuth)
  const qc        = useQueryClient()
  const { slug: urlSlug } = useParams<{ slug?: string }>()

  // Branding-Slug: Priorität URL > localStorage-Cache
  const effectiveSlug = urlSlug ?? (typeof window !== 'undefined' ? localStorage.getItem(SLUG_CACHE_KEY) : null)
  const [brandingHero, setBrandingHero] = useState<string | null>(null)

  useEffect(() => {
    if (!effectiveSlug) return
    let cancelled = false
    fetchPublicLoginBranding(effectiveSlug).then(b => {
      if (cancelled || !b) return
      setBrandingHero(b.hero_url)
    })
    return () => { cancelled = true }
  }, [effectiveSlug])

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg]           = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading, setLoading]   = useState(false)

  const [showReset,   setShowReset]   = useState(false)
  const [resetEmail,  setResetEmail]  = useState('')
  const [resetMsg,    setResetMsg]    = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleLogin() {
    if (!email) {
      setMsg({ text: 'Bitte E-Mail eingeben.', type: 'error' })
      return
    }

    setLoading(true)
    setMsg({ text: 'Anmelden …', type: 'info' })

    try {
      const res = await loginEmployee(email, password)
      qc.clear()
      setAuth({
        token:         res.token,
        employeeId:    res.employee_id,
        tenantId:      res.tenant_id,
        shortName:     res.short_name,
        email:         res.email,
        companyName:   res.company_name,
        dashboardRole: res.dashboard_role ?? null,
      })
      // RBAC: Permissions VOR Navigation laden, sonst zeigt die App
      // beim ersten Render kurz alle Buttons/Spalten (Default: alles versteckt).
      await usePermissionsStore.getState().reload()
      // Lizenz (L2): Entitlement des Tenants laden (Soft-Gating).
      await useLicenseStore.getState().reload()
      // Wenn der User einen Slug-URL benutzt hat, fuer naechste Sessions cachen.
      if (urlSlug) {
        try { localStorage.setItem(SLUG_CACHE_KEY, urlSlug) } catch { /* ignore */ }
      }
      navigate('/')
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.', type: 'error' })
      setLoading(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void handleLogin()
  }

  async function handleResetRequest() {
    if (!resetEmail) {
      setResetMsg({ text: 'Bitte E-Mail eingeben.', type: 'error' })
      return
    }
    setResetLoading(true)
    setResetMsg({ text: 'Sende …', type: 'info' })
    try {
      await requestPasswordReset(resetEmail)
      setResetMsg({ text: 'Link wurde an Ihre E-Mail-Adresse gesendet.', type: 'success' })
    } catch (err) {
      setResetMsg({ text: err instanceof Error ? err.message : 'Fehler', type: 'error' })
    } finally {
      setResetLoading(false)
    }
  }

  const [activeTheme, setActiveTheme] = useState<string | null>(null)
  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme')
    setActiveTheme(t)
    // Auch reagieren wenn sich das Theme nach Login aendert (Switcher / Tenant-Default)
    const obs = new MutationObserver(() => {
      setActiveTheme(document.documentElement.getAttribute('data-theme'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const photo = getThemePhoto(activeTheme)
  const isPhotoVariant = activeTheme?.endsWith('-foto') ?? false

  // Priorität für den Hintergrund: Tenant-Branding > Theme-Foto-Default > nichts.
  const heroToShow = brandingHero ?? photo?.src ?? null
  const hasHero = !!heroToShow

  return (
    <div
      className={`auth-container${hasHero ? ' auth-container-foto' : ''}`}
      style={hasHero ? { backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.35), rgba(0,0,0,0.10)), url(${heroToShow})` } : undefined}
    >
      {!isPhotoVariant && !hasHero && (
        <div className="auth-illustration" aria-hidden="true">
          <BranchIllustrationForTheme theme={activeTheme} />
        </div>
      )}
      <div className="auth-card">
        <div className="auth-logo"><BrandWordmark size={34} /></div>

        {!showReset ? (
          <>
            <h2 className="auth-title">Anmelden</h2>

            <FormField
              label="E-Mail"
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FormField
              label="Passwort"
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
            />

            <button
              className="btn-primary"
              onClick={() => void handleLogin()}
              disabled={loading}
            >
              Anmelden
            </button>

            {msg && <Message text={msg.text} type={msg.type} />}

            <div className="auth-links">
              <button
                className="auth-link-btn"
                type="button"
                onClick={() => { setShowReset(true); setResetMsg(null) }}
              >
                Passwort vergessen?
              </button>
              <Link to="/signup">Konto erstellen</Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="auth-title">Passwort zurücksetzen</h2>

            <FormField
              label="E-Mail"
              id="reset-email"
              type="email"
              autoComplete="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
            />

            <button
              className="btn-primary"
              onClick={() => void handleResetRequest()}
              disabled={resetLoading}
            >
              {resetLoading ? 'Bitte warten …' : 'Link anfordern'}
            </button>

            {resetMsg && <Message text={resetMsg.text} type={resetMsg.type} />}

            <div className="auth-links">
              <button
                className="auth-link-btn"
                type="button"
                onClick={() => setShowReset(false)}
              >
                ← Zurück zur Anmeldung
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
