import { fmtEur } from '@/utils/money'

/**
 * Zuschlagsbetrag in der Tabelle: positiv gruen, negativ rot (Nachlass), 0 als
 * „—". Bis Runde 1 war das so; mit dem Umbau in Runde 2 fiel die Farbe weg.
 */
export function SurchargeAmount({ value }: { value: number }) {
  if (!value) return <span className="sx-muted">—</span>
  return <span className={value > 0 ? 'sx-sur-pos' : 'sx-sur-neg'}>{fmtEur(value)}</span>
}
