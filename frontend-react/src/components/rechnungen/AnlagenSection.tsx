import { useEffect, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Paperclip, FileText, Image as ImageIcon, FileSpreadsheet, FileX } from 'lucide-react'
import { fetchAttachments, addAttachment, deleteAttachment, patchAttachment, type DocBase, type InvoiceAttachment } from '@/api/attachments'
import { uploadAsset } from '@/api/stammdaten'
import { useToast } from '@/store/toastStore'

const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/xml',
  'text/xml',
]

const MAX_BYTES = 10 * 1024 * 1024

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconForMime(mime: string) {
  if (mime.startsWith('image/')) return <ImageIcon size={14} strokeWidth={2} />
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return <FileSpreadsheet size={14} strokeWidth={2} />
  return <FileText size={14} strokeWidth={2} />
}

interface Props {
  base:  DocBase
  docId: number | null
}

export function AnlagenSection({ base, docId }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDesc, setEditDesc] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', base, docId],
    queryFn: () => docId ? fetchAttachments(base, docId) : Promise.resolve({ data: [] }),
    enabled: !!docId,
  })

  const attachments = data?.data ?? []

  const addMut = useMutation({
    mutationFn: async (file: File) => {
      if (!docId) throw new Error('Beleg muss erst gespeichert werden')
      if (!ALLOWED_MIME.includes(file.type)) throw new Error(`Dateityp nicht erlaubt: ${file.type || 'unbekannt'}`)
      if (file.size > MAX_BYTES) throw new Error(`Datei zu gross (max. ${MAX_BYTES / 1024 / 1024} MB)`)
      const up = await uploadAsset(file, 'INVOICE_ATTACHMENT')
      return addAttachment(base, docId, { asset_id: up.data.ID, description: file.name })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', base, docId] })
      toast.success('Anlage hinzugefuegt')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delMut = useMutation({
    mutationFn: (attId: number) => {
      if (!docId) throw new Error('Beleg-ID fehlt')
      return deleteAttachment(base, docId, attId)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', base, docId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const patchMut = useMutation({
    mutationFn: ({ attId, description }: { attId: number; description: string }) => {
      if (!docId) throw new Error('Beleg-ID fehlt')
      return patchAttachment(base, docId, attId, { description })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', base, docId] })
      setEditingId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) addMut.mutate(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  useEffect(() => { setEditingId(null) }, [docId])

  if (!docId) return null

  return (
    <div className="anlagen-section">
      <div className="anlagen-header">
        <Paperclip size={14} strokeWidth={2} />
        <span>Anlagen zur E-Rechnung</span>
        <span className="anlagen-hint">PDF, Bilder, Excel — werden in die XML eingebettet (max. 10 MB pro Datei)</span>
      </div>

      <ul className="anlagen-list">
        {isLoading && <li className="anlagen-loading">Laedt …</li>}
        {!isLoading && attachments.length === 0 && (
          <li className="anlagen-empty">Keine Anlagen</li>
        )}
        {attachments.map((a: InvoiceAttachment) => (
          <li key={a.ID} className="anlagen-item">
            {iconForMime(a.ASSET?.MIME_TYPE || '')}
            {editingId === a.ID ? (
              <>
                <input
                  className="anlagen-edit-input"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') patchMut.mutate({ attId: a.ID, description: editDesc })
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                />
                <button className="btn-small" onClick={() => patchMut.mutate({ attId: a.ID, description: editDesc })}>OK</button>
                <button className="btn-small" onClick={() => setEditingId(null)}>Abbr.</button>
              </>
            ) : (
              <>
                <span className="anlagen-desc" onClick={() => { setEditingId(a.ID); setEditDesc(a.DESCRIPTION || a.ASSET?.FILE_NAME || '') }} title="Klicken zum Bearbeiten">
                  {a.DESCRIPTION || a.ASSET?.FILE_NAME}
                </span>
                <span className="anlagen-meta">{fmtBytes(a.ASSET?.FILE_SIZE || 0)}</span>
                <button className="anlagen-del" onClick={() => delMut.mutate(a.ID)} aria-label="Entfernen">
                  <FileX size={14} strokeWidth={2} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        accept={ALLOWED_MIME.join(',')}
        onChange={onFileSelected}
      />
      <button
        type="button"
        className="btn-small"
        onClick={() => fileRef.current?.click()}
        disabled={addMut.isPending}
      >
        {addMut.isPending ? 'Hochladen …' : '+ Anlage hinzufuegen'}
      </button>
    </div>
  )
}
