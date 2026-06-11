import { type ReactNode } from 'react'

/**
 * Branchen-spezifische Strichzeichnungen. Alle nutzen currentColor (kommt
 * von --text bzw. spezifisch gesetzten Farben) und stroke="currentColor".
 * Wo Akzent gewuenscht ist, wird --accent via "var(--accent)" inline gesetzt.
 *
 * Skalieren mit width/height; viewBox ist 400×280 (Login-Hero-Format) bzw.
 * 200×140 wenn der Konsument "small" setzt.
 *
 * Tipp fuer Stil: alles in 1.5/2px stroke, runde Caps, transparente Flaechen.
 * Wirkt wie Bauzeichnung / Engineering-Schema, nicht wie Stock-Foto.
 */

interface Props {
  /** verkleinert die Darstellung (200x140) -- fuer Empty-States. */
  small?:    boolean
  className?: string
}

function Frame({ small, className, children }: Props & { children: ReactNode }) {
  const w = small ? 200 : 400
  const h = small ? 140 : 280
  return (
    <svg
      width={w} height={h} viewBox="0 0 400 280"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ color: 'currentColor', overflow: 'visible' }}
    >
      {children}
    </svg>
  )
}

/** Architektur: Gebaeudegrundriss + Hoch-Achsen. */
export function ArchitectureIllustration(p: Props) {
  return (
    <Frame {...p}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.7}>
        {/* Grundriss-Box */}
        <rect x="60" y="60" width="280" height="160" />
        {/* Innenwaende */}
        <line x1="180" y1="60" x2="180" y2="160" />
        <line x1="60"  y1="160" x2="280" y2="160" />
        <line x1="180" y1="120" x2="280" y2="120" />
        <line x1="240" y1="160" x2="240" y2="220" />
        {/* Tueren-Anzeigen (Viertelkreise) */}
        <path d="M180 100 A 20 20 0 0 0 200 80" />
        <path d="M180 140 A 20 20 0 0 1 160 160" />
        <path d="M260 160 A 20 20 0 0 1 280 180" />
        {/* Bemaßung */}
        <line x1="40" y1="60"  x2="40" y2="220" />
        <line x1="36" y1="60"  x2="44" y2="60"  />
        <line x1="36" y1="220" x2="44" y2="220" />
      </g>
      {/* Akzent: Sonne / Nordpfeil */}
      <g stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round">
        <circle cx="330" cy="50" r="14" />
        <line x1="330" y1="20" x2="330" y2="30" />
        <line x1="330" y1="70" x2="330" y2="80" />
        <line x1="300" y1="50" x2="310" y2="50" />
        <line x1="350" y1="50" x2="360" y2="50" />
      </g>
    </Frame>
  )
}

/** Tiefbau: Querschnitt mit Erdschichten + Rohr. */
export function CivilIllustration(p: Props) {
  return (
    <Frame {...p}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.7}>
        {/* Boden-Linie */}
        <line x1="20" y1="90" x2="380" y2="90" />
        {/* Erdschichten (Schraffur) */}
        <path d="M20 90 L380 90 L380 240 L20 240 Z" strokeDasharray="2 4" />
        <line x1="20" y1="130" x2="380" y2="130" />
        <line x1="20" y1="170" x2="380" y2="170" />
        <line x1="20" y1="210" x2="380" y2="210" />
        {/* Aushub-Trapez */}
        <line x1="120" y1="90"  x2="160" y2="200" />
        <line x1="280" y1="90"  x2="240" y2="200" />
        <line x1="160" y1="200" x2="240" y2="200" />
        {/* Strasse oben angedeutet */}
        <line x1="40" y1="80" x2="380" y2="80" strokeWidth="2" />
      </g>
      {/* Akzent: Rohr im Aushub */}
      <g stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinecap="round">
        <ellipse cx="200" cy="170" rx="34" ry="14" />
        <line x1="200" y1="156" x2="200" y2="184" opacity={0.4} />
      </g>
    </Frame>
  )
}

/** Stadt-/Verkehrsplanung: Straßenraster + Kreuzungs-Knoten. */
export function UrbanIllustration(p: Props) {
  return (
    <Frame {...p}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.6}>
        {/* Strassenraster */}
        <line x1="40"  y1="40"  x2="40"  y2="240" />
        <line x1="120" y1="40"  x2="120" y2="240" />
        <line x1="200" y1="40"  x2="200" y2="240" />
        <line x1="280" y1="40"  x2="280" y2="240" />
        <line x1="360" y1="40"  x2="360" y2="240" />
        <line x1="40"  y1="80"  x2="360" y2="80" />
        <line x1="40"  y1="140" x2="360" y2="140" />
        <line x1="40"  y1="200" x2="360" y2="200" />
        {/* Block-Schraffuren */}
        <rect x="60"  y="100" width="40" height="20" strokeWidth="1" opacity={0.4} />
        <rect x="220" y="100" width="40" height="20" strokeWidth="1" opacity={0.4} />
        <rect x="140" y="160" width="40" height="20" strokeWidth="1" opacity={0.4} />
        <rect x="300" y="160" width="40" height="20" strokeWidth="1" opacity={0.4} />
      </g>
      {/* Akzent: drei Knoten (Ampeln) */}
      <g fill="var(--accent)" stroke="var(--accent)">
        <circle cx="120" cy="140" r="5" />
        <circle cx="200" cy="80"  r="5" />
        <circle cx="280" cy="200" r="5" />
      </g>
      <g stroke="var(--accent)" strokeWidth="1.5" fill="none" strokeDasharray="3 3" opacity={0.5}>
        <line x1="120" y1="140" x2="200" y2="80" />
        <line x1="200" y1="80"  x2="280" y2="200" />
      </g>
    </Frame>
  )
}

/** TGA: Rohrschema mit Ventilen und Steigleitung. */
export function TgaIllustration(p: Props) {
  return (
    <Frame {...p}>
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.75}>
        {/* Horizontale Hauptleitung */}
        <line x1="40"  y1="80"  x2="360" y2="80" />
        {/* Steigleitungen */}
        <line x1="100" y1="80"  x2="100" y2="220" />
        <line x1="200" y1="80"  x2="200" y2="220" />
        <line x1="300" y1="80"  x2="300" y2="220" />
        {/* Untere Verteilung */}
        <line x1="80"  y1="220" x2="320" y2="220" />
        {/* Endpunkte (Heizkoerper-Symbole) */}
        <rect x="80"  y="200" width="40" height="30" />
        <rect x="180" y="200" width="40" height="30" />
        <rect x="280" y="200" width="40" height="30" />
        <line x1="90"  y1="200" x2="90"  y2="230" />
        <line x1="110" y1="200" x2="110" y2="230" />
        <line x1="190" y1="200" x2="190" y2="230" />
        <line x1="210" y1="200" x2="210" y2="230" />
        <line x1="290" y1="200" x2="290" y2="230" />
        <line x1="310" y1="200" x2="310" y2="230" />
      </g>
      {/* Akzent: Ventile als kleine Rauten */}
      <g stroke="var(--accent)" strokeWidth="2" fill="none">
        <path d="M100 130 l8 -8 l8 8 l-8 8 z" />
        <path d="M200 100 l8 -8 l8 8 l-8 8 z" />
        <path d="M300 160 l8 -8 l8 8 l-8 8 z" />
      </g>
    </Frame>
  )
}

/** Tragwerksplanung: Fachwerk-Traeger. */
export function StructuralIllustration(p: Props) {
  return (
    <Frame {...p}>
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.75}>
        {/* Obergurt + Untergurt */}
        <line x1="40"  y1="100" x2="360" y2="100" />
        <line x1="40"  y1="200" x2="360" y2="200" />
        {/* Pfosten */}
        <line x1="80"  y1="100" x2="80"  y2="200" />
        <line x1="160" y1="100" x2="160" y2="200" />
        <line x1="240" y1="100" x2="240" y2="200" />
        <line x1="320" y1="100" x2="320" y2="200" />
        {/* Diagonalen (Fachwerk) */}
        <line x1="40"  y1="100" x2="80"  y2="200" />
        <line x1="80"  y1="100" x2="160" y2="200" />
        <line x1="160" y1="100" x2="240" y2="200" />
        <line x1="240" y1="100" x2="320" y2="200" />
        <line x1="320" y1="100" x2="360" y2="200" />
        {/* Auflager */}
        <path d="M40 200 l-10 20 l20 0 z" />
        <path d="M360 200 l-10 20 l20 0 z" />
        {/* Schraffur Boden */}
        <line x1="20"  y1="225" x2="380" y2="225" strokeDasharray="3 3" />
      </g>
      {/* Akzent: Lastpfeile von oben */}
      <g stroke="var(--accent)" strokeWidth="2" fill="var(--accent)" strokeLinecap="round">
        <line x1="120" y1="60" x2="120" y2="90" />
        <path d="M115 86 l5 8 l5 -8 z" />
        <line x1="200" y1="60" x2="200" y2="90" />
        <path d="M195 86 l5 8 l5 -8 z" />
        <line x1="280" y1="60" x2="280" y2="90" />
        <path d="M275 86 l5 8 l5 -8 z" />
      </g>
    </Frame>
  )
}

/** Sucht die passende Illustration zum aktuellen data-theme. Fallback: null.
 *  Das "-foto"-Suffix wird gestrippt, damit Empty-States auch unter Foto-
 *  Varianten die jeweils passende Strichzeichnung zeigen koennen. */
export function BranchIllustrationForTheme({ theme, small, className }: { theme: string | null } & Props) {
  const base = theme?.endsWith('-foto') ? theme.slice(0, -5) : theme
  switch (base) {
    case 'architecture': return <ArchitectureIllustration small={small} className={className} />
    case 'civil':        return <CivilIllustration       small={small} className={className} />
    case 'urban':        return <UrbanIllustration       small={small} className={className} />
    case 'tga':          return <TgaIllustration         small={small} className={className} />
    case 'structural':   return <StructuralIllustration  small={small} className={className} />
    default:             return null
  }
}
