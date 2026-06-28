import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, RotateCcw, CheckCircle2, AlertTriangle, Copy, XCircle } from 'lucide-react'
import { Message } from '@/components/ui/Message'
import { InfoHint } from '@/components/ui/InfoHint'
import { HelpHint } from '@/components/ui/HelpHint'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/store/toastStore'
import {
  fetchImportDomains, fetchImportBatches, downloadImportTemplate,
  previewImport, commitImport, rollbackImportBatch,
  type ImportPreview, type DuplicateMode, type ImportRowStatus, type ImportBatch,
} from '@/api/import'

// ── Status-Darstellung ─────────────────────────────────────────────────────────
const STATUS_META: Record<ImportRowStatus, { label: string; color: string; bg: string }> = {
  ok:        { label: 'OK',       color: '#047857', bg: '#ecfdf5' },
  warning:   { label: 'Warnung',  color: '#b45309', bg: '#fffbeb' },
  duplicate: { label: 'Dublette', color: '#475569', bg: '#f1f5f9' },
  error:     { label: 'Fehler',   color: '#b91c1c', bg: '#fef2f2' },
}

function StatusBadge({ status }: { status: ImportRowStatus }) {
  const m = STATUS_META[status]
  return (
    <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────────
export function ImportSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: domainsData } = useQuery({ queryKey: ['import-domains'], queryFn: fetchImportDomains })
  const domains = domainsData?.data ?? []
  const [domainKey, setDomainKey] = useState('address')
  const domain = domains.find(d => d.key === domainKey) ?? domains[0]

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip')
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ inserted: number } | null>(null)
  const [confirmRollback, setConfirmRollback] = useState<ImportBatch | null>(null)

  const { data: batchesData } = useQuery({ queryKey: ['import-batches'], queryFn: fetchImportBatches })
  const batches = batchesData?.data ?? []

  // Nach Import/Rollback betroffene Listen + Onboarding-Fortschritt auffrischen.
  function invalidateAffected() {
    void qc.invalidateQueries({ queryKey: ['import-batches'] })
    void qc.invalidateQueries({ queryKey: ['addresses'] })
    void qc.invalidateQueries({ queryKey: ['setup-progress'] })
  }

  const previewMut = useMutation({
    mutationFn: ({ f, map }: { f: File; map: Record<string, string> | null }) => previewImport(domainKey, f, map),
    onSuccess: (res, vars) => {
      setPreview(res.data)
      // Beim ersten Lauf (ohne Mapping) die Auto-Zuordnung übernehmen.
      if (!vars.map) setMapping(res.data.mapping)
      setErr(null)
    },
    onError: (e: Error) => { setErr(e.message); setPreview(null) },
  })

  const commitMut = useMutation({
    mutationFn: () => commitImport(domainKey, file!, mapping, duplicateMode),
    onSuccess: (res) => {
      setDone({ inserted: res.data.inserted })
      toast.success(`${res.data.inserted} Datensätze importiert`)
      invalidateAffected()
      resetWizard()
    },
    onError: (e: Error) => setErr(e.message),
  })

  const rollbackMut = useMutation({
    mutationFn: (id: number) => rollbackImportBatch(id),
    onSuccess: (res) => {
      toast.success(`Import zurückgesetzt — ${res.data.deleted} Datensätze entfernt`)
      setConfirmRollback(null)
      invalidateAffected()
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmRollback(null) },
  })

  function resetWizard() {
    setFile(null); setPreview(null); setMapping({}); setDuplicateMode('skip'); setErr(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setFile(f); setDone(null); setErr(null); setMapping({})
    previewMut.mutate({ f, map: null })
  }

  function changeMapping(fieldKey: string, header: string) {
    const next = { ...mapping }
    if (header) next[fieldKey] = header; else delete next[fieldKey]
    setMapping(next)
    if (file) previewMut.mutate({ f: file, map: next })
  }

  const s = preview?.summary
  const importableCount = s ? (s.ok + s.warning + (duplicateMode === 'import' ? s.duplicate : 0)) : 0

  return (
    <div className="admin-section">
      <p className="admin-section-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'flex-start' }}>
        <span>
          Übernimm bestehende Daten per Excel/CSV — ohne Tippen. Jeder Import wird zuerst geprüft
          (nichts wird ungefragt gespeichert) und lässt sich als Ganzes wieder zurücksetzen.
        </span>
        <InfoHint title="So funktioniert der Import">
          <strong>1. Vorlage</strong> herunterladen und mit deinen Daten füllen (oder eigene Datei nutzen).<br />
          <strong>2. Hochladen</strong> → wir ordnen die Spalten automatisch zu und zeigen eine
          Vorschau mit Status je Zeile.<br />
          <strong>3. Importieren</strong> → nur fehlerfreie Zeilen werden angelegt. Dubletten und
          Fehler werden übersprungen.<br />
          Jeder Import ist ein „Stapel", den du unter <em>Letzte Importe</em> wieder rückgängig machen
          kannst.
        </InfoHint>
      </p>

      {/* ── Schritt 1: Domäne + Vorlage + Datei ─────────────────────────── */}
      <div className="admin-block">
        <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
          1 · Was möchtest du importieren?
          <HelpHint id="import.overview" />
        </h3>

        {domains.length > 1 && (
          <div className="form-group" style={{ maxWidth: 320 }}>
            <label htmlFor="imp-domain">Datenbereich</label>
            <select id="imp-domain" value={domainKey} onChange={e => { setDomainKey(e.target.value); resetWizard(); setDone(null) }}>
              {domains.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 6 }}>
          <button type="button" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => void downloadImportTemplate(domainKey)}>
            <Download size={14} strokeWidth={2} /> Vorlage „{domain?.label ?? domainKey}" herunterladen
          </button>
          <HelpHint id="import.template" />

          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onPickFile} />
          <button type="button" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} strokeWidth={2} /> Datei auswählen (CSV/Excel)
          </button>
          {file && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{file.name}</span>}
        </div>
        {domainKey === 'employee' && (
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '10px 0 0' }}>
            Hinweis: Importierte Mitarbeiter werden als Stammdaten angelegt — <strong>ohne Login und ohne Rolle</strong>.
            Zugang (Passwort) und Berechtigungen vergibst du anschließend unter <em>Mitarbeiter</em>.
          </p>
        )}
        {domainKey === 'project' && (
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '10px 0 0' }}>
            Hinweis: Es werden <strong>Projekt-Stammdaten</strong> angelegt (Nummer, Name, Status, Typ,
            Projektleiter, Bauherr). Leistungsstruktur, Verträge und Honorarsummen fügst du anschließend
            hinzu (z. B. über den HOAI-Assistenten). Status, Projektleiter und Bauherr werden über den
            Namen zugeordnet — am besten Mitarbeiter und Adressen <em>vorher</em> importieren. Tipp: den
            Projekt-Nummernkreis (Einstellungen → Nummernkreise) auf einen Zähler oberhalb deiner
            höchsten importierten Nummer setzen.
          </p>
        )}
      </div>

      {done && !preview && (
        <Message text={`Import abgeschlossen: ${done.inserted} Datensätze angelegt. Du kannst eine weitere Datei importieren.`} type="success" />
      )}
      {err && <Message text={err} type="error" />}

      {/* ── Schritt 2: Zuordnung + Vorschau ─────────────────────────────── */}
      {preview && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              2 · Spalten zuordnen
              <HelpHint id="import.mapping" />
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>
              Wir haben die Spalten deiner Datei automatisch zugeordnet. Stimmt etwas nicht, hier korrigieren.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {preview.fields.map(f => (
                <div key={f.key} className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: 12 }}>
                    {f.header}{f.required && <span style={{ color: '#b91c1c' }}> *</span>}
                  </label>
                  <select value={mapping[f.key] ?? ''} onChange={e => changeMapping(f.key, e.target.value)}>
                    <option value="">— nicht importieren —</option>
                    {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              3 · Vorschau prüfen
              <HelpHint id="import.preview" />
            </h3>

            {/* Summen-Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <SummaryChip icon={<CheckCircle2 size={13} />} label="sauber" value={s?.ok ?? 0} color="#047857" bg="#ecfdf5" />
              <SummaryChip icon={<AlertTriangle size={13} />} label="mit Warnung" value={s?.warning ?? 0} color="#b45309" bg="#fffbeb" />
              <SummaryChip icon={<Copy size={13} />} label="Dubletten" value={s?.duplicate ?? 0} color="#475569" bg="#f1f5f9" />
              <SummaryChip icon={<XCircle size={13} />} label="Fehler" value={s?.error ?? 0} color="#b91c1c" bg="#fef2f2" />
              <span style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>von {s?.total ?? 0} Zeilen</span>
            </div>

            {(s?.duplicate ?? 0) > 0 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 10 }}>
                <input type="checkbox" checked={duplicateMode === 'import'} onChange={e => setDuplicateMode(e.target.checked ? 'import' : 'skip')} />
                Dubletten trotzdem importieren
                <HelpHint id="import.duplicates" />
              </label>
            )}

            {/* Kompakte Vorschau: feste Spaltenbreiten, kein Horizontal-Scroll;
                Felder + Hinweise pro Zeile zusammengefasst. */}
            <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12 }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 92 }} />
                  <col style={{ width: '42%' }} />
                  <col />
                </colgroup>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--surface-1, #fff)', borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Zeile</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Datensatz</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Hinweise</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map(r => {
                    const data = Object.values(r.display).map(v => (v ?? '').toString().trim()).filter(Boolean).join('  ·  ')
                    const hasErr = r.messages.some(m => m.level === 'error')
                    const hasWarn = r.messages.some(m => m.level === 'warn')
                    const noteColor = hasErr ? '#b91c1c' : hasWarn ? '#b45309' : 'var(--text-3)'
                    return (
                      <tr key={r.row} style={{ borderBottom: '1px solid var(--border-subtle, #f3f4f6)', verticalAlign: 'top' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--text-3)' }}>{r.row}</td>
                        <td style={{ padding: '6px 8px' }}><StatusBadge status={r.status} /></td>
                        <td style={{ padding: '6px 8px', wordBreak: 'break-word' }}>{data || '—'}</td>
                        <td style={{ padding: '6px 8px', color: noteColor, wordBreak: 'break-word' }}>{r.messages.map(m => m.text).join('  ·  ') || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {preview.truncated && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Nur die ersten 200 Zeilen werden angezeigt; importiert werden alle.</p>}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <button type="button" className="btn-primary" disabled={commitMut.isPending || previewMut.isPending || importableCount === 0}
                onClick={() => { setErr(null); commitMut.mutate() }}>
                {commitMut.isPending ? 'Importiert …' : `${importableCount} Datensätze importieren`}
              </button>
              <button type="button" className="btn-secondary" onClick={resetWizard} disabled={commitMut.isPending}>
                Abbrechen
              </button>
              {importableCount === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Keine importierbaren Zeilen.</span>}
            </div>
          </div>
        </>
      )}

      {/* ── Letzte Importe ──────────────────────────────────────────────── */}
      <div className="admin-block">
        <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
          Letzte Importe
          <HelpHint id="import.rollback" />
        </h3>
        {!batches.length && <p className="empty-note" style={{ margin: '4px 0' }}>Noch keine Importe durchgeführt.</p>}
        {batches.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px 6px 0' }}>Datum</th>
                <th style={{ textAlign: 'left', padding: '4px 8px 6px 0' }}>Bereich</th>
                <th style={{ textAlign: 'left', padding: '4px 8px 6px 0' }}>Datei</th>
                <th style={{ textAlign: 'right', padding: '4px 8px 6px 0' }}>Angelegt</th>
                <th style={{ textAlign: 'left', padding: '4px 8px 6px 0' }}>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--border-subtle, #f3f4f6)' }}>
                  <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap' }}>{new Date(b.createdAt).toLocaleString('de-DE')}</td>
                  <td style={{ padding: '5px 8px 5px 0' }}>{b.domainLabel}</td>
                  <td style={{ padding: '5px 8px 5px 0', color: 'var(--text-3)' }}>{b.filename ?? '—'}</td>
                  <td style={{ padding: '5px 8px 5px 0', textAlign: 'right' }}>{b.rowOk}</td>
                  <td style={{ padding: '5px 8px 5px 0' }}>
                    {b.status === 'committed'
                      ? <span style={{ color: '#047857' }}>aktiv</span>
                      : <span style={{ color: 'var(--text-3)' }}>zurückgesetzt</span>}
                  </td>
                  <td style={{ padding: '5px 0', textAlign: 'right' }}>
                    {b.status === 'committed' && (
                      <button type="button" className="btn-small btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setConfirmRollback(b)} disabled={rollbackMut.isPending}>
                        <RotateCcw size={12} strokeWidth={2} /> Zurücksetzen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Rollback-Bestätigung ────────────────────────────────────────── */}
      <Modal open={!!confirmRollback} onClose={() => setConfirmRollback(null)} title="Import zurücksetzen?">
        <p style={{ fontSize: 13, marginTop: 0 }}>
          Alle aus diesem Import ({confirmRollback?.domainLabel}, {confirmRollback?.rowOk} Datensätze) angelegten
          Einträge werden gelöscht. Das ist nicht möglich, wenn inzwischen andere Daten daran hängen (z. B. ein
          Projekt an einer importierten Adresse) — dann erhältst du einen Hinweis.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={() => setConfirmRollback(null)} disabled={rollbackMut.isPending}>Abbrechen</button>
          <button type="button" className="btn-danger" disabled={rollbackMut.isPending}
            onClick={() => confirmRollback && rollbackMut.mutate(confirmRollback.id)}>
            {rollbackMut.isPending ? 'Setzt zurück …' : 'Ja, zurücksetzen'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function SummaryChip({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, color, background: bg }}>
      {icon} {value} {label}
    </span>
  )
}
