// Zentrale Marken-Assets (plan&simple). Dateien liegen in /public/brand.
// Wordmark: zwei Varianten (color/white), per CSS am data-theme umgeschaltet,
// damit der dunkle Schriftzug nicht auf dunklem Grund verschwindet.
//
// ZEITLICH BEGRENZT: In den Vorschau-Themes „trust"/„trust-dark" zeigen die
// Dateien auf umgefaerbte Varianten. Ohne das stuende in der Kopfzeile das
// alte Ampersand (#2a55d4) direkt neben der neuen Akzentfarbe — dE 34, also
// sichtbar zwei verschiedene Blaus, und die Vorschau haette etwas gezeigt,
// was der Vorschlag nicht ist. Heute faellt das nicht auf, weil #2a55d4 und
// #2563eb nur dE 7,0 auseinanderliegen.
// Welche Datei gilt, kann NICHT per CSS entschieden werden (es ist ein
// src-Attribut) — daher der Hook statt einer weiteren Klasse.
// Mit der Entscheidung: Originaldateien ersetzen, diesen Zweig und die drei
// *-trust-PNGs loeschen. docs/MARKENFARBKONZEPT_2026-09.md §6

import { useThemeName } from '@/hooks/useThemeName'

interface BrandProps {
  /** Hoehe in px; Breite skaliert automatisch. */
  size?: number
  className?: string
}

/** Schriftzug „plan&simple" — fuer Login, Sidebar etc. */
export function BrandWordmark({ size = 28, className }: BrandProps) {
  const theme = useThemeName()
  // Beide Varianten bleiben im Markup: WELCHE sichtbar ist, entscheidet
  // weiterhin das CSS (es haengt nicht nur am Theme, sondern auch am Ort —
  // Seitennavigation gegen Login-Seite).
  const color = theme === 'trust' ? '/brand/wordmark-trust.png'
    : theme === 'paper' ? '/brand/wordmark-paper.png'
    : '/brand/wordmark-color.png'
  const white = theme === 'trust-dark' ? '/brand/wordmark-trust-white.png' : '/brand/wordmark-white.png'
  return (
    <span className={`brand-wordmark${className ? ' ' + className : ''}`} role="img" aria-label="plan&simple">
      <img src={color} alt="" height={size} className="brand-wordmark-color" />
      <img src={white} alt="" height={size} className="brand-wordmark-white" />
    </span>
  )
}

/** Icon-Mark (blaues „&") — fuer kompakte Stellen wie den Mobile-Header. */
export function BrandMark({ size = 24, className }: BrandProps) {
  const theme = useThemeName()
  const src = theme === 'trust' || theme === 'trust-dark' ? '/brand/icon-256-trust.png'
    : theme === 'paper' ? '/brand/icon-256-paper.png'
    : '/brand/icon-256.png'
  return (
    <img
      src={src}
      alt="plan&simple"
      width={size}
      height={size}
      className={`brand-mark${className ? ' ' + className : ''}`}
    />
  )
}
