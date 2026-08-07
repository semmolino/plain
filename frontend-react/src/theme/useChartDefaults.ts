import { useEffect } from 'react'
import { Chart as ChartJS } from 'chart.js'
import { useChartTheme } from './chartTheme'

/**
 * Koppelt die globalen Chart.js-Defaults ans Theme: Achsen, Gitter, Legende
 * und Tooltip. Vorher setzten die Diagramme dafuer gar keine Farben — Chart.js
 * nimmt dann sein Default-Grau (#666), das auf dunklem Grund verschwindet.
 *
 * BEWUSST nicht in der App-Shell aufgerufen: der `chart.js`-Import wuerde die
 * Bibliothek (~190 kB) ins Haupt-Bundle ziehen und damit auch den Login und
 * alle Seiten ohne Diagramm verlangsamen. Stattdessen ruft ihn jede Seite auf,
 * die ohnehin schon Chart.js laedt.
 */
export function useChartDefaults(): void {
  const t = useChartTheme()

  useEffect(() => {
    ChartJS.defaults.color       = t.textMuted
    ChartJS.defaults.borderColor = t.grid
    ChartJS.defaults.font.family = "'Hanken Grotesk', system-ui, sans-serif"

    // Die Plugin-Defaults existieren erst, wenn das jeweilige Plugin
    // registriert ist — daher defensiv zuweisen.
    const legend = ChartJS.defaults.plugins?.legend
    if (legend?.labels) legend.labels.color = t.text

    const tooltip = ChartJS.defaults.plugins?.tooltip
    if (tooltip) {
      tooltip.backgroundColor = t.tooltipBg
      tooltip.titleColor      = t.tooltipFg
      tooltip.bodyColor       = t.tooltipFg
      tooltip.padding         = 10
      tooltip.cornerRadius    = 8
    }

    // Bereits gezeichnete Diagramme neu rendern, sonst behalten sie die
    // Farben des vorherigen Themes bis zum naechsten Datenwechsel.
    for (const c of Object.values(ChartJS.instances)) c.update('none')
  }, [t])
}
