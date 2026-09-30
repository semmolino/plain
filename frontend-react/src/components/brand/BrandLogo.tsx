// Zentrale Marken-Assets (plan&simple). Dateien liegen in /public/brand.
// Stand: Design „Testversion 1" (design/testversion-1/logo).
//
// Wordmark: zwei Varianten (Nachttinte / weiss), per CSS am Ort umgeschaltet,
// damit der dunkle Schriftzug nicht auf dunklem Grund verschwindet. Das „&"
// ist eine Zeichnung (SVG), kein Schriftzeichen — nie mit einer Schrift
// nachbauen.
//
// Die frueheren Sonderdateien fuer die Vorschau-Themes „trust"/„trust-dark"
// (umgefaerbtes Ampersand) sind entfallen: die neue Wortmarke ist einfarbig
// und passt zu jedem Theme.

interface BrandProps {
  /** Hoehe in px; Breite skaliert automatisch. */
  size?: number
  className?: string
}

/** Schriftzug „plan&simple" — fuer Login, Sidebar etc. */
export function BrandWordmark({ size = 28, className }: BrandProps) {
  // Beide Varianten bleiben im Markup: WELCHE sichtbar ist, entscheidet
  // weiterhin das CSS (es haengt nicht nur am Theme, sondern auch am Ort —
  // Seitennavigation gegen Login-Seite).
  return (
    <span className={`brand-wordmark${className ? ' ' + className : ''}`} role="img" aria-label="plan&simple">
      <img src="/brand/wortmarke.svg" alt="" height={size} className="brand-wordmark-color" />
      <img src="/brand/wortmarke-weiss.svg" alt="" height={size} className="brand-wordmark-white" />
    </span>
  )
}

/** App-Icon (weisses „&" auf Nachttinte) — fuer kompakte Stellen wie den Mobile-Header. */
export function BrandMark({ size = 24, className }: BrandProps) {
  return (
    <img
      src="/brand/app-icon.svg"
      alt="plan&simple"
      width={size}
      height={size}
      className={`brand-mark${className ? ' ' + className : ''}`}
    />
  )
}
