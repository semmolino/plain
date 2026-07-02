import { useRef, useState } from 'react'
import { Message } from '@/components/ui/Message'
import { uploadAsset } from '@/api/stammdaten'

/**
 * Wiederverwendbarer Upload-Block für Firmen-Assets (Logo, Unterschrift, …).
 * Lädt die Datei via /assets/upload hoch und meldet die neue ASSET-ID über
 * onSave zurück. Wird sowohl im Unternehmen-Tab (Unterschrift) als auch im
 * Dokumentenvorlagen-Tab (Logo je Unternehmen) verwendet.
 */
export function AssetUploadBlock({ label, hint, assetId, dataUri, onSave, onRemove, isPending, assetType }: {
  label: string
  hint?: string
  assetId: number | null
  dataUri: string | null
  onSave: (id: number) => void
  onRemove: () => void
  isPending: boolean
  assetType: string
}) {
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setMsg(null); setUploading(true)
    try {
      const res = await uploadAsset(file, assetType)
      onSave(res.data.ID)
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Upload fehlgeschlagen', type: 'error' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="admin-block">
      <h3 className="admin-block-title">{label}</h3>
      {assetId ? (
        <div style={{ marginBottom: 10 }}>
          <img
            src={dataUri ?? `/api/v1/assets/${assetId}`}
            alt={label}
            style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', display: 'block', marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 4, padding: 4, background: '#fafafa' }}
          />
          <button type="button" className="btn-small btn-danger" onClick={onRemove} disabled={isPending}>
            Entfernen
          </button>
        </div>
      ) : (
        <p className="empty-note" style={{ margin: '4px 0 10px' }}>Kein Bild gesetzt.</p>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={e => void handleFile(e)} />
        <button type="button" className="btn-small" onClick={() => inputRef.current?.click()} disabled={uploading || isPending}>
          {uploading ? 'Wird hochgeladen …' : assetId ? 'Ersetzen' : 'Hochladen'}
        </button>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{hint ?? 'PNG, JPG, SVG · max. 10 MB'}</span>
      </label>
      <Message text={msg?.text ?? null} type={msg?.type} />
    </div>
  )
}
