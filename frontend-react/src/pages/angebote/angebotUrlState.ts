/**
 * Zustand der Angebotsseite in der URL (UI-Pilot, nach Runde 3) — dasselbe
 * Muster wie die Projekte (pages/projekte/projektUrlState.ts).
 *
 * Vorher hielt die Seite Reiter und Angebot in `location.state` und im
 * localStorage; die URL blieb `/angebote`. Kein Angebot liess sich verlinken,
 * Zurueck im Browser verliess die Seite, und wer „Angebotsstruktur" anklickte,
 * landete im zuletzt geoeffneten Angebot — auch wenn er ein anderes meinte.
 *
 *   /angebote                                → Angebotsliste
 *   /angebote?offerId=12                     → Arbeitsbereich, Reiter Struktur
 *   /angebote?offerId=12&tab=kalkulationen   → Arbeitsbereich, Reiter Kalkulationen
 *
 * Alte Einstiege (`state: { offerId, tab }` aus Schnellzugriff, Adresse,
 * Kalkulation) werden in die URL uebersetzt; der alte Reiter „hoai" heisst
 * jetzt „kalkulationen".
 */

export type AngebotTab = 'struktur' | 'kalkulationen' | 'daten'

export const ANGEBOT_TABS: AngebotTab[] = ['struktur', 'kalkulationen', 'daten']

export type AngebotView =
  | { view: 'list' }
  | { view: 'workspace'; offerId: number; tab: AngebotTab }

function toId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : raw != null && raw !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

function toTab(raw: string | null | undefined): AngebotTab | null {
  if (raw === 'hoai') return 'kalkulationen'
  return raw && (ANGEBOT_TABS as string[]).includes(raw) ? raw as AngebotTab : null
}

/**
 * Ansicht aus URL und Navigations-State. `canonical` ist die Such-Zeichenkette,
 * auf die die URL gebracht werden soll (per `replace`), null heisst: passt.
 */
export function resolveAngebotView(
  params: URLSearchParams,
  state: { tab?: string; offerId?: number | string } | null,
): { view: AngebotView; canonical: string | null } {
  const oid = toId(params.get('offerId')) ?? toId(state?.offerId)
  const tabRaw = params.get('tab') ?? state?.tab ?? null
  const view: AngebotView = oid != null && tabRaw !== 'liste'
    ? { view: 'workspace', offerId: oid, tab: toTab(tabRaw) ?? 'struktur' }
    : { view: 'list' }
  const want = serializeAngebotView(view)
  const hasState = !!(state && (state.tab != null || state.offerId != null))
  return { view, canonical: want === params.toString() && !hasState ? null : want }
}

export function serializeAngebotView(v: AngebotView): string {
  if (v.view === 'list') return ''
  const p = new URLSearchParams()
  p.set('offerId', String(v.offerId))
  p.set('tab', v.tab)
  return p.toString()
}

/** Pfad samt Suche — fuer Links von anderen Seiten (Schnellzugriff, Adresse). */
export function angebotHref(offerId: number, tab: AngebotTab = 'struktur') {
  return `/angebote?${serializeAngebotView({ view: 'workspace', offerId, tab })}`
}
