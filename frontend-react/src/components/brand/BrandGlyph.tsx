import type { CSSProperties } from 'react'

// Freigestelltes Marken-"&" (plan&simple, RGBA mit Alpha). Wird als CSS-Maske
// genutzt, damit die exakte Logo-Form füllbar ist: zwei deckungsgleiche, auf
// die &-Silhouette maskierte Flächen — unten die blasse (leere), darüber die
// volle, die per clip-path von unten nach oben sichtbar wird.
const AMP_URL = '/brand/ampersand.png'

interface Props {
  /** Kantenlänge in px (quadratische Box, "&" wird darin zentriert). */
  size?: number
  /** Füllgrad 0…1 — binär (0/1) oder fortlaufend (Streak, Reife, Leistungsstände). */
  fill?: number
  /** Volle Farbe; default var(--brand-glyph) → App-Akzent. */
  color?: string
  /** Farbe der leeren Silhouette; default var(--brand-glyph-empty). */
  emptyColor?: string
  /** Sanfte Füll-Transition bei echter Wertänderung. Default an, bewusst dezent. */
  animate?: boolean
  /** Wenn gesetzt: role="img" + aria-label; sonst dekorativ. */
  title?: string
  className?: string
}

export function BrandGlyph({
  size = 24, fill = 1, color, emptyColor, animate = true, title, className,
}: Props) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0))
  const full  = color ?? 'var(--brand-glyph, var(--accent, #2563eb))'
  const empty = emptyColor ?? 'var(--brand-glyph-empty, rgba(37,99,235,0.18))'

  const maskBase: CSSProperties = {
    position: 'absolute', inset: 0,
    WebkitMaskImage: `url("${AMP_URL}")`, maskImage: `url("${AMP_URL}")`,
    WebkitMaskSize: 'contain', maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center', maskPosition: 'center',
  }

  return (
    <span
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        position: 'relative', display: 'inline-block',
        width: size, height: size, flexShrink: 0, verticalAlign: 'middle',
      }}
    >
      <span aria-hidden="true" style={{ ...maskBase, background: empty }} />
      <span
        aria-hidden="true"
        style={{
          ...maskBase,
          background: full,
          clipPath: `inset(${((1 - f) * 100).toFixed(2)}% 0 0 0)`,
          transition: animate ? 'clip-path 0.5s ease-out' : undefined,
        }}
      />
    </span>
  )
}
