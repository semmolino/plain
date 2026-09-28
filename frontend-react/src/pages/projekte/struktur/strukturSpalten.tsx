import { useStickyState } from '@/hooks/useStickyState'
import { fmtEur } from '@/utils/money'
import type { ChooserColumn } from '@/components/ui/ColumnChooser'

/**
 * Optionale Spalten der Projekt- und Angebotsstruktur (Rueckmeldung Runde 3).
 * „Element" und „Honorar" bleiben immer — ohne sie ist eine Zeile nicht zu
 * lesen. „inkl. Zuschl." ist zunaechst aus: mit allen Spalten passt die
 * luftige Tabelle nicht mehr in 1280 px, und die Summe steht auch im Tooltip
 * von „Gesamt".
 */
export type StrukturSpalte = 'bt' | 'sur' | 'inkl' | 'nkpct' | 'nk' | 'total'

export const STRUKTUR_SPALTEN: ChooserColumn<StrukturSpalte>[] = [
  { key: 'bt',    label: 'Abrechnung' },
  { key: 'sur',   label: 'Zuschläge €' },
  { key: 'inkl',  label: 'inkl. Zuschläge €' },
  { key: 'nkpct', label: 'NK %' },
  { key: 'nk',    label: 'Nebenkosten €' },
  { key: 'total', label: 'Gesamt €' },
]

export function useStrukturSpalten(storageKey: string) {
  const [hidden, setHidden] = useStickyState<Set<StrukturSpalte>>(
    storageKey,
    () => new Set<StrukturSpalte>(['inkl']),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as StrukturSpalte[] : ['inkl']) },
  )
  const toggle = (k: StrukturSpalte) => setHidden(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s })
  const show = (k: StrukturSpalte) => !hidden.has(k)
  // Kontrollkaestchen, Griff, Element, Honorar, Aktionen + die sichtbaren optionalen
  const colCount = 5 + STRUKTUR_SPALTEN.filter(c => !hidden.has(c.key)).length
  return { hidden, toggle, show, colCount }
}

/**
 * Zuschlagsbetrag in der Tabelle: positiv gruen, negativ rot (Nachlass), 0 als
 * „—". Bis Runde 1 war das so; mit dem Umbau in Runde 2 fiel die Farbe weg.
 */
export function SurchargeAmount({ value }: { value: number }) {
  if (!value) return <span className="sx-muted">—</span>
  return <span className={value > 0 ? 'sx-sur-pos' : 'sx-sur-neg'}>{fmtEur(value)}</span>
}
