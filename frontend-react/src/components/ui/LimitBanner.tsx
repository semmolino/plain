import { useQuery } from '@tanstack/react-query'
import { fetchLicenseUsage } from '@/api/license'

/**
 * Zeigt die Nutzung eines Mengenlimits an („8 von 10 Mitarbeitern"), sobald im
 * Plan eine Grenze gesetzt ist. Ohne Grenze (unbegrenzt) rendert die Komponente
 * nichts — dann gibt es nichts anzuzeigen.
 *
 * Rein informativ: das harte Limit setzt das Backend durch (402). Diese Anzeige
 * warnt frühzeitig, statt den Nutzer erst beim Anlegen auflaufen zu lassen.
 */
export function LimitBanner({ capability }: { capability: string }) {
  const { data } = useQuery({
    queryKey: ['license-usage'],
    queryFn: () => fetchLicenseUsage(),
    staleTime: 30_000,
  })

  const item = data?.usage.find((u) => u.key === capability)
  if (!item || item.limit == null) return null

  const reached = item.used >= item.limit
  const near = !reached && item.used >= Math.ceil(item.limit * 0.8)
  if (!reached && !near) {
    // Genug Luft: dezent im Ton, aber sichtbar (Transparenz über die Grenze).
    return (
      <div className="limit-note" role="status">
        {item.used} von {item.limit} {item.unit} genutzt
      </div>
    )
  }

  return (
    <div className={`limit-note ${reached ? 'reached' : 'near'}`} role="status">
      {reached ? (
        <>
          <strong>Limit erreicht:</strong> {item.used} von {item.limit} {item.unit}. Zum Anlegen weiterer bitte
          den Tarif erweitern.
        </>
      ) : (
        <>
          {item.used} von {item.limit} {item.unit} genutzt — Limit fast erreicht.
        </>
      )}
    </div>
  )
}
