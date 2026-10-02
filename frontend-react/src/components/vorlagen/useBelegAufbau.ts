import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchCatalog, fetchVariants } from '@/api/documentTemplates'
import { fetchDocumentTexts } from '@/api/documentTexts'
import {
  fetchDocumentLayout, previewDocumentLayout, saveDocumentLayout,
  type DocumentLayoutSave, type LayoutDocKind,
} from '@/api/documentLayouts'
import { differs, effectiveLayout, toOverride, type LayoutState } from './layoutModel'

/**
 * Zustand des Panels „Aufbau und Texte dieses Belegs" im Rechnungsassistenten.
 *
 * Gespeichert wird nicht sofort, sondern mit dem Schritt — der Assistent ruft
 * `save()` in „Entwurf speichern", vor dem Buchen und vor der PDF-Vorschau.
 * So bucht niemand einen Beleg, dessen Aufbau noch im Browser hängt.
 *
 * Ebenen: Firmenvorlage → Projekt → Beleg. Je nach „Für dieses Projekt merken"
 * geht die Abweichung in die Projekt-Ebene (und der Beleg folgt ihr) oder nur
 * in den Beleg — jeweils nur, was gegenüber der Ebene darunter abweicht.
 */
export function useBelegAufbau(kind: LayoutDocKind, id: number | null) {
  const qc = useQueryClient()
  const { data: catalog } = useQuery({ queryKey: ['doc-catalog'], queryFn: () => fetchCatalog().then(r => r.data), staleTime: 10 * 60_000 })
  const [edit, setEdit] = useState<{ state?: LayoutState; remember: boolean; templateId?: number | null } | null>(null)
  // Umgeschaltete Vorlage: deren Ebenen laden, bevor sie gespeichert ist
  const switched = edit?.templateId !== undefined
  const { data: rawInfo } = useQuery({
    queryKey: ['doc-layout', kind, id, switched ? edit!.templateId : 'saved'],
    queryFn: () => fetchDocumentLayout(kind, id as number, switched ? edit!.templateId : undefined).then(r => r.data),
    enabled: !!id,
    placeholderData: prev => prev,
  })
  const { data: rawVariants } = useQuery({ queryKey: ['doc-variants'], queryFn: () => fetchVariants().then(r => r.data), staleTime: 5 * 60_000 })
  const variants = Array.isArray(rawVariants) ? rawVariants : []
  const { data: rawSnippets } = useQuery({ queryKey: ['document-texts'], queryFn: () => fetchDocumentTexts().then(r => r.data), staleTime: 5 * 60_000 })

  // Nur verwenden, was die erwartete Form hat — das Panel ist eine Zugabe im
  // Assistenten und darf ihn nie mitreißen (etwa vor dem Deploy-Hook, wenn
  // der Server die Route noch nicht kennt).
  const info = rawInfo && Array.isArray(rawInfo.template) && Array.isArray(rawInfo.projectParents) ? rawInfo : undefined
  const snippets = Array.isArray(rawSnippets) ? rawSnippets : []
  const cat = Array.isArray(catalog?.categories) ? catalog.categories.find(c => c.key === info?.category) : undefined
  const layers = useMemo(() => {
    if (!cat || !info) return null
    const below = [...info.template, ...info.projectParents]
    return {
      template:     effectiveLayout(cat, info.template),
      belowProject: effectiveLayout(cat, below),
      project:      effectiveLayout(cat, [...below, info.project]),
      saved:        effectiveLayout(cat, [...below, info.project, info.document]),
    }
  }, [cat, info])

  const state = edit?.state ?? layers?.saved ?? null
  const remember = edit?.remember ?? false
  const savedTemplateId = info?.templateId ?? null
  const templateId = switched ? (edit!.templateId ?? null) : savedTemplateId
  const templateChanged = templateId !== savedTemplateId
  const dirty = !!edit && !!layers && !!state && (templateChanged || remember || differs(state, layers.saved))

  function payload(): DocumentLayoutSave {
    if (!layers || !state) return {}
    const tpl: DocumentLayoutSave = templateChanged ? { templateId } : {}
    if (remember) {
      return { ...tpl, project: differs(state, layers.belowProject) ? toOverride(state, layers.belowProject) : null, document: null }
    }
    return { ...tpl, document: differs(state, layers.project) ? toOverride(state, layers.project) : null }
  }

  async function save() {
    if (!dirty || !id) return
    await saveDocumentLayout(kind, id, payload())
    setEdit(null)
    await qc.invalidateQueries({ queryKey: ['doc-layout', kind, id] })
  }

  async function removeProjectLayout() {
    if (!id) return
    await saveDocumentLayout(kind, id, { project: null })
    await qc.invalidateQueries({ queryKey: ['doc-layout', kind, id] })
  }

  return {
    ready: !!(cat && info && layers && state),
    cat, info, layers, state,
    snippets,
    placeholders: Array.isArray(catalog?.placeholders) ? catalog.placeholders : [],
    remember, dirty,
    setState:    (next: LayoutState) => setEdit(e => ({ ...(e ?? { remember: false }), state: next })),
    setRemember: (on: boolean) => setEdit(e => ({ ...(e ?? {}), state: e?.state ?? state!, remember: on })),
    /** Beleg wieder wie Projekt bzw. Vorlage */
    resetDocument: () => { if (layers) setEdit(e => ({ ...(e ?? {}), state: layers.project, remember: false })) },
    /** Vorlagen-Variante wählen (null = Standard); eigene Änderungen am Aufbau setzen auf der neuen Vorlage neu auf */
    variants, templateId,
    setTemplate: (tid: number | null) => setEdit(e => ({ remember: e?.remember ?? false, templateId: tid })),
    discard: () => setEdit(null),
    save, removeProjectLayout,
    /** Vorschau des Belegs mit dem ungespeicherten Stand */
    preview: (releasePpIds?: number[]) => (id
      ? previewDocumentLayout(kind, id, { ...payload(), templateId, ...(releasePpIds?.length ? { release_pp_ids: releasePpIds } : {}) }).then(r => r.html)
      : Promise.resolve('')),
    previewKey: JSON.stringify([id, state && toOverride(state), remember, templateId]),
  }
}

export type BelegAufbau = ReturnType<typeof useBelegAufbau>
