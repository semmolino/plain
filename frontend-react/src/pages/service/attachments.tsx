import { useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Image as ImageIcon, X } from 'lucide-react'
import {
  fetchAttachments, deleteAttachment, openAttachment, uploadAttachment,
  type AttachmentKind,
} from '@/api/service'

const ALLOWED = ['image/png', 'image/jpeg']
const MAX_BYTES = 5 * 1024 * 1024
export const ATT_MAX = 3

/** Lädt die ausgewählten Dateien zum bereits angelegten Eintrag hoch (best-effort sequenziell). */
export async function uploadAttachments(kind: AttachmentKind, id: number, files: File[]) {
  for (const f of files) {
    try { await uploadAttachment(kind, id, f) } catch (e) { console.warn('[attachment] upload failed:', e) }
  }
}

/** Vor dem Absenden: lokale Dateiauswahl (PNG/JPEG, ≤5 MB, ≤3) mit Datenschutz-Hinweis. */
export function AttachmentPicker({ files, onChange, max = ATT_MAX }: {
  files: File[]
  onChange: (files: File[]) => void
  max?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function add(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list).filter(f => ALLOWED.includes(f.type) && f.size <= MAX_BYTES)
    onChange([...files, ...incoming].slice(0, max))
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="att-picker">
      {files.length > 0 && (
        <div className="att-list">
          {files.map((f, i) => (
            <span key={i} className="att-chip">
              <ImageIcon size={13} strokeWidth={1.75} /> <span className="att-name">{f.name}</span>
              <button type="button" className="att-x" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Entfernen"><X size={12} strokeWidth={2.5} /></button>
            </span>
          ))}
        </div>
      )}
      {files.length < max && (
        <button type="button" className="btn-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => inputRef.current?.click()}>
          <Paperclip size={13} strokeWidth={2} /> Screenshot hinzufügen
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" multiple hidden onChange={e => add(e.target.files)} />
      <p className="att-warn">
        Screenshots können ungewollt personenbezogene oder vertrauliche Daten enthalten. Bitte sensible
        Bereiche vorher schwärzen — das Hochladen erfolgt auf eigene Verantwortung. Bild-Metadaten (EXIF)
        werden automatisch entfernt. PNG/JPEG, max. 5 MB, bis zu {max} Bilder.
      </p>
    </div>
  )
}

/** Zeigt bereits hochgeladene Anhänge eines Eintrags (öffnen / optional löschen). */
export function AttachmentStrip({ kind, id, canDelete = false }: {
  kind: AttachmentKind
  id: number
  canDelete?: boolean
}) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['service', 'attachments', kind, id], queryFn: () => fetchAttachments(kind, id) })
  const del = useMutation({
    mutationFn: (attId: number) => deleteAttachment(kind, id, attId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service', 'attachments', kind, id] }),
  })
  const items = q.data?.data ?? []
  if (items.length === 0) return null

  return (
    <div className="att-view">
      {items.map(a => (
        <span key={a.id} className="att-chip">
          <button type="button" className="att-open" onClick={() => openAttachment(kind, id, a.id)} title="Anhang öffnen">
            <ImageIcon size={12} strokeWidth={1.75} /> {a.filename}
          </button>
          {canDelete && (
            <button type="button" className="att-x" onClick={() => del.mutate(a.id)} aria-label="Löschen"><X size={11} strokeWidth={2.5} /></button>
          )}
        </span>
      ))}
    </div>
  )
}
