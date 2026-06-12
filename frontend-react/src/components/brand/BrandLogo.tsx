// Zentrale Marken-Assets (plan&simple). Dateien liegen in /public/brand.
// Wordmark: zwei Varianten (color/white), per CSS am data-theme umgeschaltet,
// damit der dunkle Schriftzug nicht auf dunklem Grund verschwindet.

interface BrandProps {
  /** Hoehe in px; Breite skaliert automatisch. */
  size?: number
  className?: string
}

/** Schriftzug „plan&simple" — fuer Login, Sidebar etc. */
export function BrandWordmark({ size = 28, className }: BrandProps) {
  return (
    <span className={`brand-wordmark${className ? ' ' + className : ''}`} role="img" aria-label="plan&simple">
      <img src="/brand/wordmark-color.png" alt="" height={size} className="brand-wordmark-color" />
      <img src="/brand/wordmark-white.png" alt="" height={size} className="brand-wordmark-white" />
    </span>
  )
}

/** Icon-Mark (blaues „&") — fuer kompakte Stellen wie den Mobile-Header. */
export function BrandMark({ size = 24, className }: BrandProps) {
  return (
    <img
      src="/brand/icon-256.png"
      alt="plan&simple"
      width={size}
      height={size}
      className={`brand-mark${className ? ' ' + className : ''}`}
    />
  )
}
