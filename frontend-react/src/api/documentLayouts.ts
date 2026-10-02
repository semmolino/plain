import { apiClient } from './client'
import type { LayoutOverride } from './documentTemplates'

/**
 * Aufbau je Beleg und je Projekt (Vorlagen-Plan Stufe 3,
 * backend/controllers/documentLayouts.js). Rechnungen aller Art liegen unter
 * /invoices, Abschläge unter /partial-payments.
 */
export type LayoutDocKind = 'invoice' | 'advance'

const base = (kind: LayoutDocKind, id: number) => (kind === 'invoice' ? `/invoices/${id}` : `/partial-payments/${id}`)

export interface DocumentLayoutInfo {
  category:       string
  booked:         boolean
  /** Vorlagen-Variante dieses Belegs (null = Standard) */
  templateId?:    number | null
  projectId:      number | null
  /** darf den Aufbau für das ganze Projekt merken (projects.edit) */
  canEditProject: boolean
  /** Firmenvorlage, schon in Anwendungsreihenfolge */
  template:       LayoutOverride[]
  /** Projekt-Aufbau der Elternkategorien (Teilschluss → Schluss) */
  projectParents: LayoutOverride[]
  /** Projekt-Aufbau genau dieser Belegart */
  project:        LayoutOverride | null
  /** Aufbau dieses Belegs */
  document:       LayoutOverride | null
  /** Kopf-/Fußtext ohne eigene Texte (Standardtext der Belegart) */
  standardTexts:  { intro: string | null; closing: string | null }
}

export interface DocumentLayoutSave {
  /** null entfernt die Ebene, weglassen lässt sie stehen */
  document?: LayoutOverride | null
  project?:  LayoutOverride | null
  /** Vorlagen-Variante; null = Standard */
  templateId?: number | null
}

/** Mit `templateId` die Ebenen einer anderen Vorlage — zum Umschalten vor dem Speichern. */
export const fetchDocumentLayout = (kind: LayoutDocKind, id: number, templateId?: number | null) =>
  apiClient.get<{ data: DocumentLayoutInfo }>(`${base(kind, id)}/layout${templateId !== undefined ? `?template_id=${templateId ?? ''}` : ''}`)

export const saveDocumentLayout = (kind: LayoutDocKind, id: number, body: DocumentLayoutSave) =>
  apiClient.put<{ data: { ok: boolean } }>(`${base(kind, id)}/layout`, body)

/** PDF des Belegs mit ungespeicherten Abweichungen — für die Seitenansicht im Assistenten. */
export const previewDocumentLayout = (kind: LayoutDocKind, id: number, body: DocumentLayoutSave & { release_pp_ids?: number[] }) =>
  apiClient.postForBytes(`${base(kind, id)}/pdf/preview`, body)
