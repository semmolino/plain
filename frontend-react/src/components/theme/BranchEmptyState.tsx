import { useEffect, useState, type ReactNode } from 'react'
import { BranchIllustrationForTheme } from './BranchIllustrations'

interface Props {
  title:    string
  hint?:    string
  action?:  ReactNode
}

/**
 * Empty-State mit branchen-passender Strichzeichnung. Wenn das aktuelle
 * Theme keine Branche ist (light, dark, modern etc.), faellt es auf einen
 * dezenten Default-Text ohne Bild zurueck.
 */
export function BranchEmptyState({ title, hint, action }: Props) {
  const [theme, setTheme] = useState<string | null>(null)
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme'))
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="branch-empty-state">
      <div className="branch-empty-state-illustration" aria-hidden="true">
        <BranchIllustrationForTheme theme={theme} small />
      </div>
      <div className="branch-empty-state-title">{title}</div>
      {hint   && <div className="branch-empty-state-hint">{hint}</div>}
      {action && <div className="branch-empty-state-action">{action}</div>}
    </div>
  )
}
