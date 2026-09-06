/**
 * Controlling-Ampel: aus einer Kennzahl wird eine Stufe.
 *
 * Bewusst ohne React-Bezug, damit die Regeln in `kpiLevel.test.ts` direkt
 * geprueft werden koennen — wann ein Projekt „beobachten" ist, ist eine
 * kaufmaennische Aussage und nicht am Formular festzumachen.
 *
 * Warum eine eigene Ebene neben den Statusfarben: --success heisst
 * „gespeichert / gebucht", --kpi-good heisst „wirtschaftlich ueber Ziel".
 * Vorher trugen dieselben vier Farben beide Bedeutungen, und die Ampel in
 * der Projektliste stand als hartkodiertes #16a34a/#b45309/#b91c1c im TSX —
 * theme-blind und ohne zweiten Wahrnehmungskanal.
 *
 * Konzept: docs/FARBKONZEPT_2026-09.md §4.
 */

/** Stufen der Ampel. 'unknown' heisst „nicht bewertbar", nicht „in Ordnung". */
export type KpiLevel = 'good' | 'plan' | 'watch' | 'critical' | 'unknown'

/** CSS-Variable zur Stufe. 'unknown' bleibt bewusst gedeckte Textfarbe. */
export const KPI_COLOR: Record<KpiLevel, string> = {
  good:     'var(--kpi-good)',
  plan:     'var(--kpi-plan)',
  watch:    'var(--kpi-watch)',
  critical: 'var(--kpi-critical)',
  unknown:  'var(--text-3)',
}

/** Klartext der Stufe — zweiter Wahrnehmungskanal neben der Farbe. */
export const KPI_LABEL: Record<KpiLevel, string> = {
  good:     'über Ziel',
  plan:     'im Plan',
  watch:    'beobachten',
  critical: 'Handlungsbedarf',
  unknown:  'nicht bewertbar',
}

/**
 * CPI-Schwellen.
 *
 * `watch` ist die Grenze zwischen „im Plan" und „beobachten", `critical` die
 * zwischen „beobachten" und „Handlungsbedarf". Ein CPI von 1,0 heisst: die
 * erbrachte Leistung deckt die Kosten genau.
 */
export interface CpiThresholds {
  /** ab hier „im Plan" (Standard 0,95) */
  watch:    number
  /** ab hier „beobachten" (Standard 0,80) */
  critical: number
}

/**
 * Standardwerte. Sie stammen aus der bisherigen, fest verdrahteten Ampel in
 * `projectForecasting.ts` und bleiben deshalb die Vorbelegung: Ein Buero, das
 * nichts einstellt, sieht weiterhin genau das, was es bisher gesehen hat.
 *
 * ACHTUNG, Unterschied zum WIP-Report: Dort heisst „nichts gepflegt" =
 * „Spalte bleibt aus", weil dort sonst eine erfundene Zahl behauptet wuerde.
 * Hier existiert die Einfaerbung bereits — sie wegzunehmen waere ein
 * Rueckschritt, kein Schutz vor Falschaussagen.
 */
export const CPI_DEFAULTS: CpiThresholds = { watch: 0.95, critical: 0.80 }

/**
 * Schwellen aus den Vorbelegungen lesen.
 *
 * Unplausible oder leere Werte fallen auf den Standard zurueck, statt die
 * Ampel abzuschalten oder eine kaputte Grenze zu benutzen. `critical` muss
 * unter `watch` liegen — sonst waere die mittlere Stufe leer und ein Projekt
 * spraenge von „im Plan" direkt auf „Handlungsbedarf".
 */
export function readCpiThresholds(defaults: Record<string, string | null> | undefined): CpiThresholds {
  const num = (key: string, fallback: number) => {
    const n = Number(String(defaults?.[key] ?? '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 && n <= 5 ? n : fallback
  }
  const watch    = num('kpi_cpi_watch_threshold',    CPI_DEFAULTS.watch)
  const critical = num('kpi_cpi_critical_threshold', CPI_DEFAULTS.critical)
  return critical < watch ? { watch, critical } : CPI_DEFAULTS
}

/**
 * Stufe zu einem CPI.
 *
 * Es gibt bewusst KEINE Stufe „good" aus dem CPI allein: Ein CPI ueber 1
 * heisst, dass weniger gekostet hat als geleistet wurde — das ist der
 * Normalfall eines gesunden Projekts, nicht eine Auszeichnung. Wer jede
 * gesunde Zeile gruen faerbt, macht die Liste unlesbar und nimmt Rot die
 * Wirkung (Alarmmuedigkeit, siehe Konzept §2).
 */
export function cpiLevel(cpi: number | null | undefined, t: CpiThresholds): KpiLevel {
  if (cpi == null || !Number.isFinite(cpi)) return 'unknown'
  if (cpi >= t.watch)    return 'plan'
  if (cpi >= t.critical) return 'watch'
  return 'critical'
}

/**
 * Stufe zu einer Abweichung in Euro (VAC: Budget minus Prognose).
 *
 * Hier ist die Richtung eindeutig — negativ heisst Mehrkosten. Die Hoehe
 * bewertet die CPI-Ampel, deshalb nur zwei Stufen: kein Handlungsbedarf
 * oder einer.
 */
export function vacLevel(vac: number | null | undefined): KpiLevel {
  if (vac == null || !Number.isFinite(vac)) return 'unknown'
  return vac >= 0 ? 'plan' : 'critical'
}
