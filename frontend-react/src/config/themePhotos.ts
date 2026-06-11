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
//
// Quelle: Unsplash (Lizenz erlaubt kommerzielle Nutzung ohne Attribution,
// Photograph wird trotzdem genannt -- gute Praxis).
export const THEME_PHOTOS: Record<string, ThemePhoto> = {
  'architecture-foto': {
    src:          '/themes/architecture-foto/hero.jpg',
    alt:          'Moderne Architektur — Betonfassade mit geometrischem Muster',
    photographer: 'Jisang Jung (Unsplash)',
  },
  'civil-foto': {
    src:          '/themes/civil-foto/hero.jpg',
    alt:          'Tiefbau — Blick in einen Betontunnel-Schacht',
    photographer: 'C Cai (Unsplash)',
  },
  'urban-foto': {
    src:          '/themes/urban-foto/hero.jpg',
    alt:          'Stadt-/Verkehrsplanung — Luftaufnahme eines Autobahnkreuzes',
    photographer: 'Bernd Dittrich (Unsplash)',
  },
  'tga-foto': {
    src:          '/themes/tga-foto/hero.jpg',
    alt:          'TGA — Heizungsraum mit Rohren und Manometern',
    photographer: 'Immo Wegmann (Unsplash)',
  },
  'structural-foto': {
    src:          '/themes/structural-foto/hero.jpg',
    alt:          'Tragwerksplanung — Stahltragwerk einer Brücke',
    photographer: 'Li Zhang (Unsplash)',
  },
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
