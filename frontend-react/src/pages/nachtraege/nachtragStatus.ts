import type { NachtragStructureNode } from '@/api/nachtraege'

/**
 * Tonalität der Nachtrags-Status (Runde 7). Vorher stand jeder Status als
 * weisse Schrift auf einer eigenen Farbe — auf Gelb (in Prüfung) und Hellgrün
 * lag das unter 2:1, und „teilweise beauftragt" nahm die Akzentfarbe, die an
 * keiner anderen Stelle „Status" heisst. Jetzt dieselben Paare wie Meldungen:
 * Grund `-bg`, Schrift `-strong`.
 */
export type StatusTone = 'muted' | 'info' | 'progress' | 'done' | 'problem'

const TONE: Record<string, StatusTone> = {
  DRAFT: 'muted', WITHDRAWN: 'muted',
  ANNOUNCED: 'info', SUBMITTED: 'info', IN_REVIEW: 'info',
  PARTIALLY_COMMISSIONED: 'progress',
  COMMISSIONED: 'done',
  REJECTED: 'problem', DISPUTED: 'problem',
}

export const statusTone = (code: string | null | undefined): StatusTone => TONE[code ?? ''] ?? 'muted'

/**
 * Steht die Position schon im Projekt? Dieselbe Regel wie im Backend
 * (services/nachtraege.js → isReleased): gekürzt anerkannt zählt als erledigt.
 */
export const isReleasedNode = (n: Pick<NachtragStructureNode, 'APPROVAL_STATE' | 'RELEASED_STRUCTURE_ID'>) =>
  n.RELEASED_STRUCTURE_ID != null || n.APPROVAL_STATE === 'APPROVED' || n.APPROVAL_STATE === 'PARTIAL'
