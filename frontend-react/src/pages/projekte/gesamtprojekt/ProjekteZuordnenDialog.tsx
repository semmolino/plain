import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast } from '@/store/toastStore'
import { fetchProjectListFull } from '@/api/projekte'
import { setProjectGroupMembers, type ProjectGroup } from '@/api/gesamtprojekte'
import { ProjektAuswahl } from './ProjektAuswahl'
import { movedNote, useInvalidateGroups } from './gesamtprojektUi'

/**
 * Welche Projekte gehören zu diesem Gesamtprojekt? Gespeichert wird genau die
 * angekreuzte Liste (PUT). Abgewählte Projekte verlieren nur die Zuordnung.
 */
export function ProjekteZuordnenDialog({ group, open, onClose }: {
  group:   ProjectGroup
  open:    boolean
  onClose: () => void
}) {
  if (!open) return null
  return <Inner group={group} onClose={onClose} />
}

function Inner({ group, onClose }: { group: ProjectGroup; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidateGroups()
  const [confirm, confirmDialog] = useConfirm()
  const [initial] = useState(() => new Set(group.PROJECT_IDS))
  const [selected, setSelected] = useState<Set<number>>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { data } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull })
  const projects = data?.data ?? []

  const dirty = selected.size !== initial.size || [...selected].some(id => !initial.has(id))

  async function requestClose() {
    if (pending) return
    if (dirty && !(await confirm({ title: 'Auswahl verwerfen?', message: 'Die Zuordnung bleibt, wie sie war.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  async function save() {
    if (pending) return
    if (!dirty) { onClose(); return }
    const wechseln = projects.filter(p => selected.has(p.ID) && p.PROJECT_GROUP_ID != null && p.PROJECT_GROUP_ID !== group.ID)
    if (wechseln.length) {
      const ok = await confirm({
        title: 'Aus einem anderen Gesamtprojekt übernehmen?',
        message: `${wechseln.length === 1 ? `${wechseln[0].ABBR} gehört` : `${wechseln.length} Projekte gehören`} bisher zu „${wechseln[0].GROUP_NAME}"${wechseln.length > 1 ? ' bzw. anderen' : ''}. Ein Projekt gehört zu höchstens einem Gesamtprojekt — es wechselt dann hierher.`,
        confirmLabel: 'Übernehmen',
        confirmClass: 'btn-primary',
      })
      if (!ok) return
    }
    setPending(true)
    setErr(null)
    try {
      const res = await setProjectGroupMembers(group.ID, [...selected])
      await invalidate()
      toast.success(`Zuordnung gespeichert: ${res.data.PROJECT_COUNT} ${res.data.PROJECT_COUNT === 1 ? 'Projekt' : 'Projekte'}.`)
      const note = movedNote(res.moved)
      if (note) toast.info(note)
      onClose()
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
    } finally {
      setPending(false)
    }
  }

  useCtrlS(() => void save(), true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title={`Projekte in „${group.NAME}"`} className="modal-wide">
        <div className="pg-dialog-body">
          <p className="form-field-hint">
            Kreuze die Projekte (Einzelverträge) an, die zu diesem Vorhaben gehören. Abgewählte Projekte bleiben erhalten.
          </p>
          <ProjektAuswahl projects={projects} selected={selected} onChange={setSelected}
            currentGroupId={group.ID} idPrefix="pgz" />
          <Message type="error" text={err} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()} disabled={pending}>Abbrechen</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Speichert …' : 'Zuordnung speichern'}
            </button>
          </DialogFooter>
        </div>
      </Modal>
      {confirmDialog}
    </>
  )
}
