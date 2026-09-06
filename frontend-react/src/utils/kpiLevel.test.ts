import { describe, it, expect } from 'vitest'
import {
  cpiLevel, vacLevel, costRatioLevel, readCpiThresholds, CPI_DEFAULTS, KPI_LABEL, KPI_COLOR,
} from './kpiLevel'

describe('readCpiThresholds', () => {
  it('nimmt die Standardwerte, wenn nichts gepflegt ist', () => {
    expect(readCpiThresholds(undefined)).toEqual(CPI_DEFAULTS)
    expect(readCpiThresholds({})).toEqual(CPI_DEFAULTS)
  })

  it('liest gepflegte Werte', () => {
    expect(readCpiThresholds({
      kpi_cpi_watch_threshold: '0.9', kpi_cpi_critical_threshold: '0.7',
    })).toEqual({ watch: 0.9, critical: 0.7 })
  })

  // Deutsche Tastatur, deutsches Zahlenformat: das Komma darf nicht zu NaN
  // und damit stillschweigend zum Standardwert fuehren.
  it('akzeptiert das Dezimalkomma', () => {
    expect(readCpiThresholds({
      kpi_cpi_watch_threshold: '0,9', kpi_cpi_critical_threshold: '0,7',
    })).toEqual({ watch: 0.9, critical: 0.7 })
  })

  it('faellt bei Unsinn auf den Standard zurueck, statt eine kaputte Grenze zu benutzen', () => {
    for (const bad of ['', '   ', 'abc', '0', '-1', '99']) {
      expect(readCpiThresholds({ kpi_cpi_watch_threshold: bad }).watch).toBe(CPI_DEFAULTS.watch)
    }
  })

  // Waere critical >= watch, gaebe es die mittlere Stufe nicht mehr und ein
  // Projekt spraenge von "im Plan" direkt auf "Handlungsbedarf".
  it('verwirft eine verdrehte Reihenfolge komplett', () => {
    expect(readCpiThresholds({
      kpi_cpi_watch_threshold: '0.7', kpi_cpi_critical_threshold: '0.9',
    })).toEqual(CPI_DEFAULTS)
    expect(readCpiThresholds({
      kpi_cpi_watch_threshold: '0.8', kpi_cpi_critical_threshold: '0.8',
    })).toEqual(CPI_DEFAULTS)
  })
})

describe('cpiLevel', () => {
  const t = CPI_DEFAULTS

  it('ist an den Grenzen einschliesslich', () => {
    expect(cpiLevel(0.95, t)).toBe('plan')
    expect(cpiLevel(0.80, t)).toBe('watch')
  })

  it('stuft dazwischen und darunter richtig ein', () => {
    expect(cpiLevel(1.20, t)).toBe('plan')
    expect(cpiLevel(0.94, t)).toBe('watch')
    expect(cpiLevel(0.79, t)).toBe('critical')
    expect(cpiLevel(0,    t)).toBe('critical')
  })

  // Kein Wert heisst "nicht bewertbar" — nicht "in Ordnung". Ein Projekt ohne
  // erfasste Kosten darf nicht wie ein gesundes aussehen.
  it('meldet fehlende Werte als unknown', () => {
    expect(cpiLevel(null, t)).toBe('unknown')
    expect(cpiLevel(undefined, t)).toBe('unknown')
    expect(cpiLevel(NaN, t)).toBe('unknown')
  })

  it('folgt eigenen Schwellen', () => {
    const eng = { watch: 1.05, critical: 0.99 }
    expect(cpiLevel(1.00, eng)).toBe('watch')
    expect(cpiLevel(1.05, eng)).toBe('plan')
    expect(cpiLevel(0.98, eng)).toBe('critical')
  })

  // Ein gesundes Projekt bleibt unmarkiert: waere jede gute Zeile gruen,
  // verlaere Rot seine Wirkung (Alarmmuedigkeit, Konzept §2).
  it('vergibt nie die Stufe good', () => {
    for (const cpi of [0.5, 0.8, 0.95, 1, 2, 5]) {
      expect(cpiLevel(cpi, t)).not.toBe('good')
    }
  })
})

describe('vacLevel', () => {
  it('trennt bei null', () => {
    expect(vacLevel(1)).toBe('plan')
    expect(vacLevel(0)).toBe('plan')
    expect(vacLevel(-0.01)).toBe('critical')
  })

  it('meldet fehlende Werte als unknown', () => {
    expect(vacLevel(null)).toBe('unknown')
    expect(vacLevel(NaN)).toBe('unknown')
  })
})

describe('Darstellung', () => {
  // Farbe darf nie der einzige Traeger sein (WCAG 1.4.1) — zu jeder Stufe
  // muss ein Klartext existieren.
  it('hat zu jeder Stufe einen Klartext und eine Farbe', () => {
    for (const lvl of ['good', 'plan', 'watch', 'critical', 'unknown'] as const) {
      expect(KPI_LABEL[lvl]).toBeTruthy()
      expect(KPI_COLOR[lvl]).toMatch(/^var\(--/)
    }
  })

  // Hartkodierte Hex-Werte waren genau der Fehler, den diese Ebene behebt:
  // sie folgen keinem Theme.
  it('benutzt ausschliesslich Tokens, keine festen Farbwerte', () => {
    for (const v of Object.values(KPI_COLOR)) expect(v).not.toMatch(/#[0-9a-f]{3,6}/i)
  })
})

describe('costRatioLevel', () => {
  const t = CPI_DEFAULTS

  // Der eigentliche Grund fuer diese Funktion: Kostenquote und CPI sind
  // exakt kehrwertig (Migration 0032). Zwei Schwellenpaare fuer dieselbe
  // Zahl wuerden auseinanderlaufen und in EINER Zeile widerspruechliche
  // Stufen zeigen. Dieser Test haelt die Kopplung fest.
  it('stimmt fuer jeden Wert mit cpiLevel ueberein', () => {
    for (const cpi of [0.5, 0.79, 0.8, 0.9, 0.95, 1.0, 1.3, 2.0]) {
      expect(costRatioLevel(1 / cpi, t)).toBe(cpiLevel(cpi, t))
    }
  })

  it('setzt die Grenzen bei 105,3 % und 125 %', () => {
    expect(costRatioLevel(1.0,   t)).toBe('plan')     // Kosten = Leistung
    expect(costRatioLevel(1.05,  t)).toBe('plan')     // knapp unter 1/0,95
    expect(costRatioLevel(1.06,  t)).toBe('watch')
    expect(costRatioLevel(1.24,  t)).toBe('watch')
    expect(costRatioLevel(1.26,  t)).toBe('critical') // ueber 1/0,80
  })

  it('folgt eigenen Schwellen mit', () => {
    const eng = { watch: 1.05, critical: 0.99 }
    expect(costRatioLevel(1 / 1.05, eng)).toBe('plan')
    expect(costRatioLevel(1 / 1.00, eng)).toBe('watch')
    expect(costRatioLevel(1 / 0.90, eng)).toBe('critical')
  })

  it('meldet fehlende und unsinnige Werte als unknown', () => {
    for (const v of [null, undefined, NaN, 0, -1]) {
      expect(costRatioLevel(v, t)).toBe('unknown')
    }
  })
})
