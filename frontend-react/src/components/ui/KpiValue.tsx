import { TrendingDown, TriangleAlert, Minus } from 'lucide-react'
import { KPI_COLOR, KPI_LABEL, type KpiLevel } from '@/utils/kpiLevel'

/**
 * Kennzahl mit Controlling-Ampel.
 *
 * Traegt die Aussage ueber ZWEI Kanaele: Farbe und Symbol/Klartext. Farbe
 * allein reicht nicht — Rot-Gruen-Schwaeche betrifft rund 8 % der Maenner
 * (WCAG 1.4.1). Die vorherige Ampel in der Projektliste war reine Farbe, und
 * zwar hartkodiert: `#16a34a`/`#b45309`/`#b91c1c` folgten keinem Theme.
 *
 * Der Klartext haengt zusaetzlich am `title` — der traegt Maus-Hover und
 * Screenreader gleichermassen und erklaert, WARUM die Zeile markiert ist.
 *
 * Bewusst kein Symbol bei 'plan' und 'unknown': ein Zeichen in jeder Zeile
 * ist kein Signal mehr. Markiert wird, was Aufmerksamkeit braucht.
 */
const ICON: Partial<Record<KpiLevel, typeof TrendingDown>> = {
  watch:    TrendingDown,
  critical: TriangleAlert,
  good:     Minus,          // wird derzeit nicht vergeben, siehe cpiLevel()
}

export function KpiValue({
  level,
  children,
  reason,
  bold = true,
}: {
  level: KpiLevel
  children: React.ReactNode
  /** Ergaenzt den Klartext im title, z. B. „CPI 0,78 unter 0,80". */
  reason?: string
  bold?: boolean
}) {
  const Icon = level === 'good' ? undefined : ICON[level]
  const title = reason ? `${KPI_LABEL[level]}: ${reason}` : KPI_LABEL[level]

  return (
    <span
      title={level === 'unknown' ? undefined : title}
      style={{
        color: KPI_COLOR[level],
        fontWeight: bold && level !== 'unknown' ? 600 : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 'var(--space-1)',
        whiteSpace: 'nowrap',
      }}
    >
      {Icon && <Icon size={13} strokeWidth={2} aria-hidden />}
      {children}
      {/* Nur fuer Screenreader: die Stufe im Klartext. Der title allein wird
          nicht von jeder Kombination aus Screenreader und Browser vorgelesen. */}
      {level !== 'unknown' && <span className="sr-only">{` — ${KPI_LABEL[level]}`}</span>}
    </span>
  )
}
