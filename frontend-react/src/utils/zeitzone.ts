/**
 * Umrechnung von Zeitplan-Uhrzeiten zwischen Büro- und Gerätezeit.
 *
 * WARUM ES DAS GIBT
 *   Ein Zeitplan gilt für das ganze Büro — er kann deshalb nicht „in der Zeit
 *   des jeweiligen Betrachters" gespeichert werden, sonst verschöbe sich der
 *   Versandzeitpunkt, je nachdem wer zuletzt gespeichert hat. Gespeichert wird
 *   also EINE feste Bürozeit (APP_TIMEZONE, Vorgabe Europe/Berlin).
 *
 *   Angezeigt und eingegeben wird dagegen immer in der Zeit des Geräts, vor dem
 *   der Nutzer gerade sitzt. Alles andere hieße, dass er im Kopf umrechnet —
 *   und genau daran scheitert die Einstellung dann im Alltag.
 *
 *   Für alle, die in derselben Zone wie das Büro sitzen (der Normalfall), ist
 *   die Umrechnung die Identität: 16:00 bleibt 16:00. Sichtbar wird sie erst
 *   auf Reisen oder in einem Team über Zeitzonen hinweg.
 *
 * GENAUIGKEIT
 *   Umgerechnet wird mit dem Zonenversatz von HEUTE. Über eine
 *   Sommerzeitumstellung hinweg kann sich der Versatz ändern; der Zeitplan
 *   selbst bleibt aber an der Bürozeit verankert und verschiebt sich nicht.
 */

/** Versatz einer Zone gegenüber UTC in Minuten (östlich = positiv). */
function zonenVersatzMinuten(zone: string, referenz: Date): number {
  try {
    const teile = new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(referenz)                             // "2026-08-19 13:49"
    const alsUtc = Date.parse(teile.replace(' ', 'T') + ':00Z')
    // Sekunden der Referenz wegschneiden, sonst verfälschen sie die Differenz.
    const referenzMinute = Math.floor(referenz.getTime() / 60000) * 60000
    return Math.round((alsUtc - referenzMinute) / 60000)
  } catch {
    // Unbekannte Zone: lieber nicht umrechnen als falsch umrechnen.
    return -referenz.getTimezoneOffset()
  }
}

/** Zeitzone des Geräts, z. B. "Europe/Berlin". */
export function geraeteZeitzone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'lokal'
  } catch {
    return 'lokal'
  }
}

/**
 * Unterschied zwischen Geräte- und Bürozeit in Minuten.
 * 0 = beide Zonen gehen gleich, es ist nichts umzurechnen.
 */
export function versatzZuBuero(bueroZone: string | null | undefined, referenz = new Date()): number {
  if (!bueroZone) return 0
  const geraet = -referenz.getTimezoneOffset()
  return geraet - zonenVersatzMinuten(bueroZone, referenz)
}

function verschiebe(zeit: string, minuten: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(zeit || ''))
  if (!m) return zeit
  const gesamt = Number(m[1]) * 60 + Number(m[2]) + minuten
  // Modulo über den Tag: 23:30 + 2 h ist 01:30, nicht 25:30.
  const normiert = ((gesamt % 1440) + 1440) % 1440
  const hh = String(Math.floor(normiert / 60)).padStart(2, '0')
  const mm = String(normiert % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Gespeicherte Bürozeit ("HH:MM") → Uhrzeit auf dem Gerät des Betrachters. */
export function bueroZuGeraet(zeit: string, bueroZone: string | null | undefined, referenz = new Date()): string {
  return verschiebe(zeit, versatzZuBuero(bueroZone, referenz))
}

/** Eingegebene Gerätezeit ("HH:MM") → Bürozeit zum Speichern. */
export function geraetZuBuero(zeit: string, bueroZone: string | null | undefined, referenz = new Date()): string {
  return verschiebe(zeit, -versatzZuBuero(bueroZone, referenz))
}

/**
 * Zusatz für die Beschriftung, wenn Gerät und Büro auseinanderliegen.
 * Im Normalfall (gleiche Zone) bewusst null — dann ist jeder Hinweis nur
 * Rauschen.
 */
export function bueroHinweis(
  geraeteZeit: string,
  bueroZone: string | null | undefined,
  referenz = new Date(),
): string | null {
  if (!bueroZone) return null
  if (versatzZuBuero(bueroZone, referenz) === 0) return null
  return `entspricht ${geraetZuBuero(geraeteZeit, bueroZone, referenz)} Uhr im Büro (${bueroZone})`
}
