import { useId } from 'react'

// Silhouette des Marken-"&" (entnommen aus public/favicon.svg). viewBox 0 0 48 46.
// Wird als füllbares Icon genutzt: leere Silhouette (Outline-Gefühl) + ein von
// unten steigender, auf die &-Form geclippter Füllbereich ("Liquid").
const AMP_PATH = 'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z'
const VB_W = 48
const VB_H = 46

interface Props {
  /** Breite in px; Höhe skaliert proportional. */
  size?: number
  /** Füllgrad 0…1 (0 = leer/Outline, 1 = voll). */
  fill?: number
  /** Glyph-Farbe; default var(--brand-glyph) → App-Akzent. */
  color?: string
  /** Opazität der leeren Silhouette. */
  emptyOpacity?: number
  /** Wenn gesetzt: role="img" + aria-label; sonst dekorativ (aria-hidden). */
  title?: string
  className?: string
}

/**
 * Marken-"&" mit Füllstand. Binär: fill 0 oder 1. Fortlaufend: Teilfüllung,
 * die von unten ansteigt (z. B. Streak, Modul-Reife, Leistungsstände).
 */
export function BrandGlyph({ size = 24, fill = 1, color, emptyOpacity = 0.16, title, className }: Props) {
  const rawId = useId()
  const clipId = `amp-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const f = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0))
  const fillTop = VB_H * (1 - f)
  return (
    <svg
      width={size}
      height={Math.round((size * VB_H) / VB_W)}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', color: color ?? 'var(--brand-glyph, var(--accent, #2563eb))', flexShrink: 0 }}
    >
      <defs>
        <clipPath id={clipId}><path d={AMP_PATH} /></clipPath>
      </defs>
      {/* leere Silhouette */}
      <path d={AMP_PATH} fill="currentColor" opacity={emptyOpacity} />
      {/* Füllung von unten, auf die &-Form geclippt */}
      {f > 0 && (
        <rect
          x="0" y={fillTop} width={VB_W} height={VB_H - fillTop}
          fill="currentColor" clipPath={`url(#${clipId})`}
        />
      )}
    </svg>
  )
}
