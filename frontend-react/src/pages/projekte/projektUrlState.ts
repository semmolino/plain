/**
 * Zustand der Projektseite in der URL (UI-Pilot 2026-09).
 *
 * Vorher las die Seite `?tab=` und `?projectId=` einmal und loeschte die URL
 * danach (`setSearchParams({}, { replace: true })`). Folge: kein Tab und kein
 * Projekt liess sich verlinken, und der Zurueck-Knopf des Browsers verliess
 * die Seite, statt zum vorigen Tab zu gehen.
 *
 * Jetzt ist die URL der Zustand:
 *   /projekte                               → Projektliste
 *   /projekte?tab=honorar                   → Kalkulationen ohne Projekt
 *   /projekte?projectId=12                  → Arbeitsbereich, Tab Struktur
 *   /projekte?projectId=12&tab=buchungen    → Arbeitsbereich, Tab Buchungen
 *
 * Die alten Einstiege funktionieren weiter: `location.state` mit tab/projectId
 * (sieben Stellen im Code) wird in die URL uebersetzt, ein Arbeitsbereich-Tab
 * ohne Projekt (Benachrichtigungen: `?tab=buchungen`) nimmt das zuletzt
 * geoeffnete Projekt.
 */

export type ProjektTab =
  | 'struktur' | 'leistungsstand' | 'buchungen' | 'nachtraege'
  | 'vertraege' | 'honorar' | 'mitarbeiter' | 'budget'

export type ListTab = 'liste' | 'honorar'

export const WORKSPACE_TABS: ProjektTab[] = [
  'struktur', 'leistungsstand', 'buchungen', 'nachtraege',
  'vertraege', 'honorar', 'mitarbeiter', 'budget',
]

export const SELECTED_PID_KEY = 'projekte-selected-pid'

export type ProjektView =
  | { view: 'list'; listTab: ListTab; pendingTab: ProjektTab | null }
  | { view: 'workspace'; projectId: number; tab: ProjektTab }

function isWorkspaceTab(s: string | null | undefined): s is ProjektTab {
  return !!s && (WORKSPACE_TABS as string[]).includes(s)
}

function toId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : raw != null && raw !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Bestimmt die Ansicht aus URL, Navigations-State und dem zuletzt gewaehlten
 * Projekt. `canonical` ist die Such-Zeichenkette, auf die die URL gebracht
 * werden soll, falls sie abweicht (per `replace`, nicht als neuer Verlaufs-
 * eintrag) — null heisst: URL passt.
 */
export function resolveProjektView(
  params: URLSearchParams,
  state: { tab?: string; projectId?: number | string } | null,
  savedPid: number | null,
): { view: ProjektView; canonical: string | null } {
  const urlTab = params.get('tab')
  const urlPid = toId(params.get('projectId'))
  const stTab  = state?.tab ?? null
  const stPid  = toId(state?.projectId)

  const tabRaw = urlTab ?? stTab
  const pid    = urlPid ?? stPid

  let view: ProjektView
  if (pid != null && tabRaw !== 'liste') {
    view = { view: 'workspace', projectId: pid, tab: isWorkspaceTab(tabRaw) ? tabRaw : 'struktur' }
  } else if (pid == null && isWorkspaceTab(tabRaw) && tabRaw !== 'honorar' && savedPid != null) {
    // Benachrichtigung „?tab=buchungen" ohne Projekt → zuletzt geoeffnetes Projekt
    view = { view: 'workspace', projectId: savedPid, tab: tabRaw }
  } else if (tabRaw === 'honorar' && pid == null) {
    view = { view: 'list', listTab: 'honorar', pendingTab: null }
  } else {
    view = { view: 'list', listTab: 'liste', pendingTab: isWorkspaceTab(tabRaw) ? tabRaw : null }
  }

  // Neu schreiben, wenn die URL abweicht ODER ein Navigations-State vorliegt —
  // der muss weg, sonst gewinnt er bei jedem weiteren Rendern gegen die URL.
  const want = serializeProjektView(view)
  const have = params.toString()
  const hasState = !!(state && (state.tab != null || state.projectId != null))
  return { view, canonical: want === have && !hasState ? null : want }
}

export function serializeProjektView(v: ProjektView): string {
  const p = new URLSearchParams()
  if (v.view === 'workspace') {
    p.set('projectId', String(v.projectId))
    p.set('tab', v.tab)
  } else if (v.listTab === 'honorar') {
    p.set('tab', 'honorar')
  } else if (v.pendingTab) {
    p.set('tab', v.pendingTab)
  }
  return p.toString()
}
