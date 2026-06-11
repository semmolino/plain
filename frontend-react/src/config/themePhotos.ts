/**
 * Themen-spezifische Hintergrundbilder fuer die Login-Seite.
 *
 * Ablage-Konvention:
 *   public/themes/{theme-id}/hero.webp  oder .jpg
 *
 * Wenn ein Eintrag fehlt oder src auf null steht, faellt LoginPage auf die
 * vorhandenen SVG-Illustrationen zurueck.
 *
 * Attribution (Unsplash empfiehlt, ist aber nicht zwingend):
 *   alt-Text + optional ein dezenter Credits-Hinweis im Footer.
 */

export interface ThemePhoto {
  /** Pfad relativ zum Root, z.B. "/themes/architecture/hero.webp" */
  src:          string | null
  /** Beschreibung fuer Screenreader. */
  alt:          string
  /** Photographer-Name fuer Attribution (optional). */
  photographer?: string
}

// Foto-Variante pro Branche. Die Strich-Variante hat dieselbe Palette aber
// keinen Eintrag hier -> faellt auf die SVG-Illustration zurueck.
export const THEME_PHOTOS: Record<string, ThemePhoto> = {
  'architecture-foto': { src: null, alt: 'Moderne Architektur — Beton- und Glasfassade' },
  'civil-foto':        { src: null, alt: 'Tiefbau — Tunnel oder Brückenbaustelle' },
  'urban-foto':        { src: null, alt: 'Stadtplanung — Luftaufnahme einer Kreuzung' },
  'tga-foto':          { src: null, alt: 'TGA — Industrielle Rohrtechnik' },
  'structural-foto':   { src: null, alt: 'Tragwerksplanung — Stahlfachwerk' },
}

/** Lookup-Helfer: Foto-Variante? Rueckgabe enthaelt src (kann null sein wenn
 *  noch nicht hinterlegt) und alt. */
export function getThemePhoto(theme: string | null): ThemePhoto | null {
  if (!theme) return null
  return THEME_PHOTOS[theme] ?? null
}

/** Strich-Variante? Strippt das "-foto"-Suffix damit BranchIllustrationForTheme
 *  weiterhin das passende SVG findet, wenn jemand z.B. fuer Empty-States doch
 *  das SVG sehen will. */
export function stripFotoSuffix(theme: string | null): string | null {
  if (!theme) return null
  return theme.endsWith('-foto') ? theme.slice(0, -5) : theme
}
