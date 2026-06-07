import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }      from '@/components/ui/Tabs'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import { useToast }  from '@/store/toastStore'
import {
  fetchCountries, fetchCompanies, createDepartment, createTyp, createRolle,
  createCompany, updateCompany, fetchCurrencies, fetchVatList, fetchDefaults, putDefault,
  fetchDepartments, deleteDepartment, updateDepartment,
  fetchTypen, deleteTyp, updateTyp,
  fetchRollen, deleteRolle, updateRolle,
  fetchCompanyAssets, putCompanyLogo, putCompanySignature, uploadAsset,
  fetchMonatsabschluss, putMonatsabschluss, runMonatsabschlussNow, openMonatsabschlussPdf,
  fetchWorkingTimeModels, createWorkingTimeModel, updateWorkingTimeModel, deleteWorkingTimeModel,
  fetchCountryStates,
  type Company, type StammdatenItem, type Rolle, type MonatsabschlussSettings,
  type WorkingTimeModel, type WorkingTimeModelPayload, type CountryState,
} from '@/api/stammdaten'
import { fetchProjectStatuses, type ProjectStatus } from '@/api/projekte'
import { useCtrlS } from '@/hooks/useCtrlS'
import { fetchNumberRanges, saveNumberRanges } from '@/api/numberRanges'
import {
  fetchMahnungSettings, saveMahnungSettings, fetchTextTemplates, saveTextTemplate,
  TEXT_TEMPLATE_LABELS,
  type MahnungSettingsLevel, type TextTemplate, type TextTemplateType,
} from '@/api/mahnungen'
import {
  fetchOverhead, saveOverhead, copyOverheadFromYear,
  fetchEmployeeParams, saveEmployeeParamsBulk, calculateRates, importRates,
  type OverheadItem, type EmployeeCalcParams, type CalcResult,
} from '@/api/kostensatz'
import { fetchEmployeeList } from '@/api/mitarbeiter'
import {
  fetchArbzgSettings, saveArbzgSettings,
  fetchBreakRules, upsertBreakRule, deleteBreakRule,
  type ArbzgSettings, type BreakRule,
} from '@/api/arbzg'
import {
  fetchNotificationConfigs, upsertNotificationConfig,
  type NotificationTypeConfig,
} from '@/api/notificationConfig'
import {
  fetchNotificationSchedule, upsertNotificationSchedule, runNotificationScheduleNow,
} from '@/api/notificationSchedule'
import { fetchActiveEmployees } from '@/api/projekte'
import { Modal } from '@/components/ui/Modal'

const PAGE_TABS = [
  { id: 'stammdaten',              label: 'Stammdaten'              },
  { id: 'nummernkreise',           label: 'Nummernkreise'           },
  { id: 'unternehmen',             label: 'Unternehmen'             },
  { id: 'vorbelegungen',           label: 'Vorbelegungen'           },
  { id: 'arbeitszeitmodelle',      label: 'Arbeitszeitmodelle'      },
  { id: 'pausenregeln',            label: 'Pausenregeln'            },
  { id: 'arbzg',                   label: 'ArbZG-Einstellungen'     },
  { id: 'monatsabschluss',         label: 'Monatsabschluss'         },
  { id: 'kostensatz',              label: 'Kostensatz-Rechner'      },
  { id: 'mahnungseinstellungen',   label: 'Mahnungseinstellungen'   },
  { id: 'textvorlagen',            label: 'Textvorlagen'            },
  { id: 'benachrichtigungen',      label: 'Benachrichtigungen'      },
]

// ── Small helpers ─────────────────────────────────────────────────────────────

function TagList({ items, onDelete, onEdit }: {
  items: { ID: number; label: string }[]
  onDelete: (id: number) => void
  onEdit?: (id: number, newLabel: string) => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editVal,   setEditVal]   = useState('')

  function startEdit(it: { ID: number; label: string }) {
    setEditingId(it.ID); setEditVal(it.label)
  }
  function saveEdit() {
    if (editingId && editVal.trim()) onEdit?.(editingId, editVal.trim())
    setEditingId(null)
  }
  function cancelEdit() { setEditingId(null) }

  if (!items.length) return <p className="empty-note" style={{ margin: '4px 0 8px' }}>Noch keine Einträge.</p>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
      {items.map(it => (
        <span key={it.ID} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>
          {editingId === it.ID ? (
            <>
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 3, padding: '1px 4px', width: 120 }}
              />
              <button type="button" onClick={saveEdit}   style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#059669', fontSize: 14, lineHeight: 1, padding: 0 }} title="Speichern">✓</button>
              <button type="button" onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, lineHeight: 1, padding: 0 }} title="Abbrechen">✗</button>
            </>
          ) : (
            <>
              {it.label}
              {onEdit && <button type="button" onClick={() => startEdit(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 11, lineHeight: 1, padding: '0 0 0 2px' }} title="Bearbeiten">✎</button>}
              <button type="button" onClick={() => onDelete(it.ID)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, lineHeight: 1, padding: 0 }} title="Löschen">×</button>
            </>
          )}
        </span>
      ))}
    </div>
  )
}

function SingleInputMutation({
  label, placeholder, onSubmit, isPending,
}: {
  label: string; placeholder?: string; onSubmit: (v: string) => void; isPending: boolean
}) {
  const [val, setVal] = useState('')
  return (
    <div className="admin-input-row">
      <input
        className="admin-single-input"
        placeholder={placeholder ?? 'Name eingeben …'}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onSubmit(val.trim()); setVal('') } }}
      />
      <button
        className="btn-small btn-save"
        disabled={isPending || !val.trim()}
        onClick={() => { onSubmit(val.trim()); setVal('') }}
        type="button"
      >
        {isPending ? '…' : 'Hinzufügen'}
      </button>
      <span className="admin-field-label">{label}</span>
    </div>
  )
}

// ── Stammdaten ────────────────────────────────────────────────────────────────

function StammdatenSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [rolleShort, setRolleShort] = useState('')
  const [rolleLong,  setRolleLong]  = useState('')
  const [rolleSpRate, setRolleSpRate] = useState('')

  // Inline edit for Rollen
  const [editingRolleId,   setEditingRolleId]   = useState<number | null>(null)
  const [editingRolleForm, setEditingRolleForm] = useState({ short: '', long: '', spRate: '' })

  function startEditRolle(r: Rolle) {
    setEditingRolleId(r.ID)
    setEditingRolleForm({ short: r.NAME_SHORT, long: r.NAME_LONG ?? '', spRate: r.SP_RATE != null ? String(r.SP_RATE) : '' })
  }

  const { data: deptData  } = useQuery({ queryKey: ['departments'],   queryFn: fetchDepartments })
  const { data: typenData  } = useQuery({ queryKey: ['typen'],        queryFn: fetchTypen })
  const { data: rollenData } = useQuery({ queryKey: ['rollen'],       queryFn: fetchRollen })
  const departments  = deptData?.data   ?? []
  const typen        = typenData?.data  ?? []
  const rollen       = rollenData?.data ?? []

  function withMsg(mutFn: () => void) { setMsg(null); mutFn() }

  const deptMut = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => { setMsg({ text: 'Abteilung gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['departments'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delDeptMut = useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['departments'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const updDeptMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateDepartment(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['departments'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const typMut = useMutation({
    mutationFn: createTyp,
    onSuccess: () => { setMsg({ text: 'Typ gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['typen'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delTypMut = useMutation({
    mutationFn: deleteTyp,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['typen'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const updTypMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateTyp(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['typen'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const rolleMut = useMutation({
    mutationFn: ({ short, long, spRate }: { short: string; long: string; spRate: string }) => createRolle(short, long, spRate),
    onSuccess: () => {
      setMsg({ text: 'Rolle gespeichert ✅', type: 'success' })
      setRolleShort(''); setRolleLong(''); setRolleSpRate('')
      void qc.invalidateQueries({ queryKey: ['rollen'] })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delRolleMut = useMutation({
    mutationFn: deleteRolle,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rollen'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const updRolleMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateRolle>[1] }) => updateRolle(id, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rollen'] }); setEditingRolleId(null) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  return (
    <div className="admin-section">
      <div className="admin-block">
        <h3 className="admin-block-title">Abteilungen</h3>
        <TagList
          items={departments.map((d: StammdatenItem) => ({ ID: d.ID, label: d.NAME_SHORT }))}
          onDelete={id => withMsg(() => delDeptMut.mutate(id))}
          onEdit={(id, name) => withMsg(() => updDeptMut.mutate({ id, name }))}
        />
        <SingleInputMutation label="Abteilung" onSubmit={v => withMsg(() => deptMut.mutate(v))} isPending={deptMut.isPending} />
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Projekttypen</h3>
        <TagList
          items={typen.map((t: StammdatenItem) => ({ ID: t.ID, label: t.NAME_SHORT }))}
          onDelete={id => withMsg(() => delTypMut.mutate(id))}
          onEdit={(id, name) => withMsg(() => updTypMut.mutate({ id, name }))}
        />
        <SingleInputMutation label="Typ" onSubmit={v => withMsg(() => typMut.mutate(v))} isPending={typMut.isPending} />
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Rollen</h3>
        {rollen.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Kürzel</th>
                <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Bezeichnung</th>
                <th style={{ textAlign: 'right', padding: '2px 0 4px 6px' }}>Stundensatz</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rollen.map((r: Rolle) => (
                <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {editingRolleId === r.ID ? (
                    <>
                      <td style={{ padding: '3px 6px 3px 0' }}>
                        <input autoFocus className="tbl-input" style={{ width: 70 }} value={editingRolleForm.short} onChange={e => setEditingRolleForm(f => ({ ...f, short: e.target.value }))} />
                      </td>
                      <td style={{ padding: '3px 6px 3px 0' }}>
                        <input className="tbl-input" style={{ width: 130 }} value={editingRolleForm.long} onChange={e => setEditingRolleForm(f => ({ ...f, long: e.target.value }))} />
                      </td>
                      <td style={{ padding: '3px 0 3px 6px', textAlign: 'right' }}>
                        <input className="tbl-input num" type="number" step="0.01" min="0" style={{ width: 70 }} value={editingRolleForm.spRate} onChange={e => setEditingRolleForm(f => ({ ...f, spRate: e.target.value }))} placeholder="0.00" />
                      </td>
                      <td style={{ padding: '3px 0 3px 6px', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn-small btn-save" style={{ padding: '1px 6px', fontSize: 11 }} disabled={updRolleMut.isPending} onClick={() => updRolleMut.mutate({ id: r.ID, body: { name_short: editingRolleForm.short, name_long: editingRolleForm.long, sp_rate: editingRolleForm.spRate } })}>
                          {updRolleMut.isPending ? '…' : '✓'}
                        </button>
                        <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginLeft: 2 }} onClick={() => setEditingRolleId(null)}>✗</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '3px 6px 3px 0', fontWeight: 600 }}>{r.NAME_SHORT}</td>
                      <td style={{ padding: '3px 6px 3px 0', color: '#374151' }}>{r.NAME_LONG ?? '—'}</td>
                      <td style={{ padding: '3px 0 3px 6px', textAlign: 'right', color: '#374151' }}>
                        {r.SP_RATE != null ? `${r.SP_RATE} €/h` : '—'}
                      </td>
                      <td style={{ padding: '3px 0 3px 6px', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginRight: 2 }} onClick={() => startEditRolle(r)}>✎</button>
                        <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => withMsg(() => delRolleMut.mutate(r.ID))}>×</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!rollen.length && <p className="empty-note" style={{ margin: '4px 0 8px' }}>Noch keine Rollen.</p>}
        <div className="form-row">
          <div className="form-group">
            <label>Kürzel*</label>
            <input value={rolleShort} onChange={e => setRolleShort(e.target.value)} placeholder="z. B. PL" />
          </div>
          <div className="form-group">
            <label>Bezeichnung</label>
            <input value={rolleLong} onChange={e => setRolleLong(e.target.value)} placeholder="z. B. Projektleiter" />
          </div>
          <div className="form-group">
            <label>Stundensatz</label>
            <input type="number" step="0.01" min="0" value={rolleSpRate} onChange={e => setRolleSpRate(e.target.value)} placeholder="z. B. 95.00" />
          </div>
        </div>
        <button
          className="btn-small btn-save"
          disabled={rolleMut.isPending || !rolleShort.trim()}
          onClick={() => { setMsg(null); rolleMut.mutate({ short: rolleShort.trim(), long: rolleLong.trim(), spRate: rolleSpRate.trim() }) }}
          type="button"
        >
          {rolleMut.isPending ? 'Speichert …' : 'Hinzufügen'}
        </button>
      </div>

      <Message text={msg?.text ?? null} type={msg?.type} />
    </div>
  )
}

// ── Nummernkreise ─────────────────────────────────────────────────────────────

const YEAR = new Date().getFullYear()

function nrFormatInvoice(v: number) {
  const c = String(Math.max(0, v)).padStart(4, '0')
  return `RE-${YEAR}-${c}`
}
function nrFormatProject(v: number) {
  const yy = String(YEAR % 100).padStart(2, '0')
  const c  = String(Math.max(0, v)).padStart(3, '0')
  return `P-${yy}-${c}`
}
function nrFormatOffer(v: number) {
  const yy = String(YEAR % 100).padStart(2, '0')
  const c  = String(Math.max(0, v)).padStart(3, '0')
  return `A-${yy}-${c}`
}

function NummernkreiseSection() {
  const [invoiceNext, setInvoiceNext] = useState(1)
  const [projectNext, setProjectNext] = useState(1)
  const [offerNext,   setOfferNext]   = useState(1)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['number-ranges', YEAR],
    queryFn:  () => fetchNumberRanges(YEAR),
    staleTime: 0,
  })

  useEffect(() => {
    if (data) {
      setInvoiceNext(data.next_counter ?? 1)
      setProjectNext(data.project_next_counter ?? 1)
      setOfferNext(data.offer_next_counter ?? 1)
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: saveNumberRanges,
    onSuccess: () => setMsg({ text: 'Nummernkreise gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!Number.isFinite(invoiceNext) || invoiceNext < 1 || invoiceNext > 9999) {
      setMsg({ text: 'Rechnungsnummer: Wert 1–9999', type: 'error' }); return
    }
    if (!Number.isFinite(projectNext) || projectNext < 1 || projectNext > 999) {
      setMsg({ text: 'Projektnummer: Wert 1–999', type: 'error' }); return
    }
    if (!Number.isFinite(offerNext) || offerNext < 1 || offerNext > 999) {
      setMsg({ text: 'Angebotsnummer: Wert 1–999', type: 'error' }); return
    }
    setMsg(null)
    saveMut.mutate({ year: YEAR, next_counter: invoiceNext, project_next_counter: projectNext, offer_next_counter: offerNext })
  }

  useCtrlS(handleSave, !isLoading)

  return (
    <div className="admin-section">
      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title">Rechnungen / Abschlagsrechnungen ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input type="number" min={1} max={9999} value={invoiceNext} onChange={e => setInvoiceNext(parseInt(e.target.value, 10) || 1)} />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatInvoice(invoiceNext)}</p>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Projekte ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input type="number" min={1} max={999} value={projectNext} onChange={e => setProjectNext(parseInt(e.target.value, 10) || 1)} />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatProject(projectNext)}</p>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Angebote ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input type="number" min={1} max={999} value={offerNext} onChange={e => setOfferNext(parseInt(e.target.value, 10) || 1)} />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatOffer(offerNext)}</p>
          </div>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleSave} disabled={saveMut.isPending} type="button">
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Unternehmen ───────────────────────────────────────────────────────────────

const EMPTY_COMPANY_FORM = {
  company_name_1: '', company_name_2: '', street: '', post_code: '', city: '',
  post_office_box: '', country_id: '', tax_number: '', tax_id: '',
  bic: '', iban: '', creditor_id: '',
}

function companyToForm(c: Company) {
  return {
    company_name_1: c.COMPANY_NAME_1 ?? '',
    company_name_2: c.COMPANY_NAME_2 ?? '',
    street:         c.STREET ?? '',
    post_code:      c.POST_CODE ?? '',
    city:           c.CITY ?? '',
    post_office_box: c.POST_OFFICE_BOX ?? '',
    country_id:     c.COUNTRY_ID ?? '',
    tax_number:     c.TAX_NUMBER ?? '',
    tax_id:         c['TAX-ID'] ?? '',
    bic:            c.BIC ?? '',
    iban:           c.IBAN ?? '',
    creditor_id:    c['CREDITOR-ID'] ?? '',
  }
}

function AssetUploadBlock({ label, hint, assetId, dataUri, onSave, onRemove, isPending, assetType }: {
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

function CompanyAssetsSection({ companyId }: { companyId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const queryKey = ['company-assets', companyId]
  const { data } = useQuery({ queryKey, queryFn: () => fetchCompanyAssets(companyId) })
  const assets = data?.data

  const logoMut = useMutation({
    mutationFn: (assetId: number | null) => putCompanyLogo(companyId, assetId),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  })
  const sigMut = useMutation({
    mutationFn: (assetId: number | null) => putCompanySignature(companyId, assetId),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
      <AssetUploadBlock
        label="Firmenlogo (für PDF-Dokumente)"
        assetId={assets?.logo_asset_id ?? null}
        dataUri={assets?.logo_data_uri ?? null}
        onSave={id => logoMut.mutate(id)}
        onRemove={() => logoMut.mutate(null)}
        isPending={logoMut.isPending}
        assetType="LOGO"
      />
      <AssetUploadBlock
        label="Unterschrift (Angebot + Auftragsbestätigung)"
        hint="PNG, JPG · Empfehlung: weißer oder transparenter Hintergrund"
        assetId={assets?.sig_asset_id ?? null}
        dataUri={assets?.sig_data_uri ?? null}
        onSave={id => sigMut.mutate(id)}
        onRemove={() => sigMut.mutate(null)}
        isPending={sigMut.isPending}
        assetType="SIGNATURE"
      />
    </div>
  )
}

function UnternehmenSection() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_COMPANY_FORM })
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: companiesData } = useQuery({ queryKey: ['companies'], queryFn: fetchCompanies })
  const { data: countriesData } = useQuery({ queryKey: ['countries'], queryFn: fetchCountries })
  const companies = companiesData?.data ?? []
  const countries = countriesData?.data ?? []

  const loadCompany = useCallback((c: Company) => {
    setSelectedId(c.ID); setForm(companyToForm(c)); setMsg(null)
  }, [])

  function newCompany() { setSelectedId(null); setForm({ ...EMPTY_COMPANY_FORM }); setMsg(null) }

  const onSuccess = () => { void qc.invalidateQueries({ queryKey: ['companies'] }); setMsg({ text: 'Unternehmen gespeichert ✅', type: 'success' }) }
  const onError   = (e: Error) => setMsg({ text: e.message, type: 'error' })

  const createMut = useMutation({ mutationFn: createCompany, onSuccess, onError })
  const updateMut = useMutation({ mutationFn: (body: typeof form) => updateCompany(selectedId!, body), onSuccess, onError })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    if (!form.company_name_1.trim()) { setMsg({ text: 'Firmenname 1 ist erforderlich', type: 'error' }); return }
    if (selectedId !== null) updateMut.mutate(form)
    else createMut.mutate(form)
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const isPending = createMut.isPending || updateMut.isPending
  const formRef = useRef<HTMLFormElement>(null)
  useCtrlS(() => formRef.current?.requestSubmit(), !isPending)

  return (
    <div className="admin-section">
      <div className="admin-company-selector">
        {companies.map(c => (
          <button key={c.ID} type="button" className={`admin-company-btn${selectedId === c.ID ? ' active' : ''}`} onClick={() => loadCompany(c)}>
            {c.COMPANY_NAME_1}
          </button>
        ))}
        <button type="button" className={`admin-company-btn${selectedId === null ? ' active' : ''}`} onClick={newCompany}>
          + Neue Firma
        </button>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="master-form">
        <FormField label="Unternehmen*"                    id="ufn1"  value={form.company_name_1}  onChange={set('company_name_1')} required />
        <FormField label="Unternehmen (Zusatz)"            id="ufn2"  value={form.company_name_2}  onChange={set('company_name_2')} />
        <FormField label="Straße"                          id="ust"   value={form.street}          onChange={set('street')} />
        <div className="form-row">
          <FormField label="PLZ"                           id="upc"   value={form.post_code}       onChange={set('post_code')} />
          <FormField label="Stadt"                         id="uct"   value={form.city}            onChange={set('city')} />
        </div>
        <FormField label="Postfach"                        id="upob"  value={form.post_office_box} onChange={set('post_office_box')} />
        <div className="form-group">
          <label htmlFor="uco">Land</label>
          <select id="uco" value={form.country_id} onChange={set('country_id')}>
            <option value="">Bitte wählen …</option>
            {countries.map(c => <option key={c.ID} value={c.ID}>{c.NAME_SHORT}: {c.NAME_LONG}</option>)}
          </select>
        </div>
        <FormField label="Steuernummer"                    id="utn"   value={form.tax_number}      onChange={set('tax_number')} />
        <FormField label="Steuer-IdNr."                    id="uti"   value={form.tax_id}          onChange={set('tax_id')} />
        <FormField label="BIC"                             id="ubic"  value={form.bic}             onChange={set('bic')} />
        <FormField label="IBAN"                            id="uiban" value={form.iban}            onChange={set('iban')} />
        <FormField label="Gläubiger-Identifikationsnummer" id="ucid"  value={form.creditor_id}     onChange={set('creditor_id')} />
        <Message text={msg?.text ?? null} type={msg?.type} />
        <button className="btn-primary" type="submit" disabled={isPending}>
          {isPending ? 'Speichert …' : selectedId !== null ? 'Änderungen speichern' : 'Neu anlegen'}
        </button>
      </form>

      {selectedId !== null && <CompanyAssetsSection companyId={selectedId} />}
    </div>
  )
}

// ── Vorbelegungen ─────────────────────────────────────────────────────────────

function VorbelegungenSection() {
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [currencyId,     setCurrencyId]     = useState('')
  const [vatId,          setVatId]          = useState('')
  const [offerValidDays, setOfferValidDays] = useState('')
  const [cashDiscPct,    setCashDiscPct]    = useState('')
  const [cashDiscDays,   setCashDiscDays]   = useState('')
  const [offerText1,     setOfferText1]     = useState('')
  const [offerText2,     setOfferText2]     = useState('')
  const [timerEnabled,   setTimerEnabled]   = useState(true)
  const [bwEnabled,      setBwEnabled]      = useState(true)
  const [bwPcts,         setBwPcts]         = useState('75,90,100')
  const [bwNotifyPm,     setBwNotifyPm]     = useState(true)
  const [bwNotifyBooker, setBwNotifyBooker] = useState(true)

  const { data: currData } = useQuery({ queryKey: ['currencies'],   queryFn: fetchCurrencies })
  const { data: vatData  } = useQuery({ queryKey: ['vat-list'],     queryFn: fetchVatList })
  const { data: defData, isLoading } = useQuery({ queryKey: ['defaults'], queryFn: fetchDefaults })

  const currencies = currData?.data ?? []
  const vatList    = vatData?.data  ?? []

  useEffect(() => {
    if (!defData?.data) return
    setCurrencyId(defData.data.default_currency_id ?? '')
    setVatId(defData.data.default_vat_id ?? '')
    setOfferValidDays(defData.data.offer_valid_days ?? '')
    setCashDiscPct(defData.data.default_cash_discount_percent ?? '')
    setCashDiscDays(defData.data.default_cash_discount_days ?? '')
    setOfferText1(defData.data.offer_text_1 ?? '')
    setOfferText2(defData.data.offer_text_2 ?? '')
    // timer_enabled: fehlt = aktiv (Default)
    setTimerEnabled(defData.data.timer_enabled !== 'false')
    // Budget-Warnungen: Defaults wenn nicht persistiert
    setBwEnabled(defData.data.budget_warning_enabled !== 'false')
    setBwPcts(defData.data.budget_warning_default_pcts ?? '75,90,100')
    setBwNotifyPm(defData.data.budget_warning_notify_pm !== 'false')
    setBwNotifyBooker(defData.data.budget_warning_notify_booker !== 'false')
  }, [defData?.data])

  const saveMut = useMutation({
    mutationFn: async () => {
      await putDefault('default_currency_id',           currencyId     || null)
      await putDefault('default_vat_id',                vatId          || null)
      await putDefault('offer_valid_days',               offerValidDays || null)
      await putDefault('default_cash_discount_percent', cashDiscPct    || null)
      await putDefault('default_cash_discount_days',    cashDiscDays   || null)
      await putDefault('offer_text_1',                  offerText1     || null)
      await putDefault('offer_text_2',                  offerText2     || null)
      // Stempeluhr: nur den deaktivierten Zustand persistieren (Default = aktiv)
      await putDefault('timer_enabled', timerEnabled ? null : 'false')
      // Budget-Warnungen
      await putDefault('budget_warning_enabled',       bwEnabled ? null : 'false')
      await putDefault('budget_warning_default_pcts',  bwPcts.trim() || '75,90,100')
      await putDefault('budget_warning_notify_pm',     bwNotifyPm ? null : 'false')
      await putDefault('budget_warning_notify_booker', bwNotifyBooker ? null : 'false')
    },
    onSuccess: () => setMsg({ text: 'Vorbelegungen gespeichert ✅', type: 'success' }),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  useCtrlS(() => { setMsg(null); saveMut.mutate() }, !isLoading && !saveMut.isPending)

  return (
    <div className="admin-section">
      <p className="admin-section-hint">Diese Werte werden automatisch bei der Erstellung neuer Verträge vorbelegt.</p>
      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title">Vertrag</h3>
            <div className="form-group">
              <label>Währung</label>
              <select value={currencyId} onChange={e => setCurrencyId(e.target.value)}>
                <option value="">— keine Vorbelegung —</option>
                {currencies.map(c => <option key={c.ID} value={c.ID}>{c.NAME_SHORT}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>MwSt.</label>
              <select value={vatId} onChange={e => setVatId(e.target.value)}>
                <option value="">— keine Vorbelegung —</option>
                {vatList.map(v => <option key={v.ID} value={v.ID}>{v.VAT}: {v.VAT_PERCENT} %</option>)}
              </select>
            </div>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Angebote</h3>
            <div className="form-group">
              <label>Gültigkeitsdauer (Tage)</label>
              <input
                type="number" min={1} max={365} step={1}
                value={offerValidDays}
                onChange={e => setOfferValidDays(e.target.value)}
                placeholder="z. B. 30"
              />
            </div>
            <p className="admin-section-hint">Tage, um die das Gültigkeitsdatum im Angebots-Wizard vorbelegt wird.</p>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Kopftext (Vorbelegung)</label>
              <textarea
                rows={4}
                value={offerText1}
                onChange={e => setOfferText1(e.target.value)}
                placeholder="Einleitungstext, der bei jedem neuen Angebot vorbelegt wird …"
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div className="form-group">
              <label>Fußtext (Vorbelegung)</label>
              <textarea
                rows={4}
                value={offerText2}
                onChange={e => setOfferText2(e.target.value)}
                placeholder="Abschlusstext, der bei jedem neuen Angebot vorbelegt wird …"
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Skonto (Vorbelegung für neue Verträge)</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Skonto (%)</label>
                <input
                  type="number" min={0} max={100} step={0.01}
                  value={cashDiscPct}
                  onChange={e => setCashDiscPct(e.target.value)}
                  placeholder="z. B. 2"
                />
              </div>
              <div className="form-group">
                <label>Skonto-Tage</label>
                <input
                  type="number" min={0} step={1}
                  value={cashDiscDays}
                  onChange={e => setCashDiscDays(e.target.value)}
                  placeholder="z. B. 14"
                />
              </div>
            </div>
            <p className="admin-section-hint">Diese Werte werden beim Anlegen eines Vertrags vorbelegt und können pro Vertrag überschrieben werden.</p>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Stempeluhr</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={timerEnabled}
                onChange={e => setTimerEnabled(e.target.checked)}
              />
              <span>Stempeluhr aktiv</span>
            </label>
            <p className="admin-section-hint">
              Deaktiviert die Start/Pause/Stop-Buttons in der Kopfzeile. Bereits erfasste
              Buchungen bleiben unverändert sichtbar, neue Stempelvorgänge sind nicht möglich.
            </p>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Budget-Warnungen</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={bwEnabled}
                onChange={e => setBwEnabled(e.target.checked)}
              />
              <span>Budget-Warnungen aktiv</span>
            </label>
            <p className="admin-section-hint">
              Wenn deaktiviert, werden für neue Projekte keine Default-Regeln angelegt und
              bestehende Regeln werden nicht ausgewertet.
            </p>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Standard-Schwellen (% – kommagetrennt)</label>
              <input
                type="text"
                value={bwPcts}
                onChange={e => setBwPcts(e.target.value)}
                placeholder="z. B. 75, 90, 100"
              />
              <p className="admin-section-hint">
                Wird beim Anlegen neuer Projekte als Projekt-Regel materialisiert. Pro
                Projekt im Tab „Budget" anpassbar.
              </p>
            </div>
            <div className="form-group">
              <label>Standard-Empfänger</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={bwNotifyPm}
                  onChange={e => setBwNotifyPm(e.target.checked)}
                />
                <span>Projektleiter benachrichtigen</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={bwNotifyBooker}
                  onChange={e => setBwNotifyBooker(e.target.checked)}
                />
                <span>Verursachende Mitarbeiter benachrichtigen</span>
              </label>
            </div>
          </div>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <button className="btn-primary" style={{ marginTop: 8 }} disabled={saveMut.isPending} onClick={() => { setMsg(null); saveMut.mutate() }} type="button">
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Monatsabschluss ───────────────────────────────────────────────────────────

function MonatsabschlussSection() {
  const qc = useQueryClient()

  const { data: settingsRes }  = useQuery({ queryKey: ['monatsabschluss'],    queryFn: fetchMonatsabschluss })
  const { data: statusesRes }  = useQuery({ queryKey: ['project-statuses'],   queryFn: fetchProjectStatuses })

  const settings: MonatsabschlussSettings | undefined = settingsRes?.data
  const statuses: ProjectStatus[] = statusesRes?.data ?? []

  const [enabled,          setEnabled]          = useState(false)
  const [selectedStatuses, setSelectedStatuses] = useState<number[]>([])
  const [runMsg,           setRunMsg]            = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.enabled)
    setSelectedStatuses(settings.statuses ?? [])
  }, [settings])

  const saveMut = useMutation({
    mutationFn: () => putMonatsabschluss({ enabled, statuses: selectedStatuses }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monatsabschluss'] }),
  })

  const runMut = useMutation({
    mutationFn: () => runMonatsabschlussNow(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['monatsabschluss'] })
      setRunMsg({ type: 'success', text: `Test abgeschlossen: ${res.data.snapshotCount} Projekt-Snapshot${res.data.snapshotCount !== 1 ? 's' : ''} erstellt.` })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Fehler beim Ausführen'
      setRunMsg({ type: 'error', text: msg })
    },
  })

  function toggleStatus(id: number) {
    setSelectedStatuses(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function handlePdf() {
    openMonatsabschlussPdf().catch((e: unknown) => {
      const msg = (e as { message?: string })?.message ?? 'PDF konnte nicht geöffnet werden'
      setRunMsg({ type: 'error', text: msg })
    })
  }

  const lastRunFormatted = settings?.lastRunDate
    ? new Date(settings.lastRunDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Monatsabschluss</h2>

      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 16, marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 500 }}>Automatischer Monatsabschluss aktivieren</span>
        </label>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 0 }}>
          Am letzten Tag jedes Monats wird automatisch ein Projekt-Snapshot für die gewählten Projektstatus erstellt
          und eine Benachrichtigung versandt.
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>Projektstatus einschließen</div>
        {statuses.length === 0 && <p style={{ fontSize: 13, color: '#6b7280' }}>Keine Projektstatus vorhanden.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {statuses.map((s: ProjectStatus) => (
            <label key={s.ID} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, background: selectedStatuses.includes(s.ID) ? '#eff6ff' : '#f3f4f6', border: `1px solid ${selectedStatuses.includes(s.ID) ? '#93c5fd' : '#e5e7eb'}`, borderRadius: 4, padding: '4px 10px' }}>
              <input
                type="checkbox"
                checked={selectedStatuses.includes(s.ID)}
                onChange={() => toggleStatus(s.ID)}
                style={{ cursor: 'pointer' }}
              />
              {s.NAME_SHORT}
            </label>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
          Keine Auswahl = alle Projektstatus einschließen.
        </p>
      </div>

      <button
        className="btn btn-primary"
        disabled={saveMut.isPending}
        onClick={() => saveMut.mutate()}
        style={{ marginBottom: 24 }}
      >
        {saveMut.isPending ? 'Speichert …' : 'Einstellungen speichern'}
      </button>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', marginBottom: 20 }} />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Letzter Abschluss</div>
        {settings?.lastRunMonth ? (
          <p style={{ fontSize: 13, color: '#374151' }}>
            {settings.lastRunMonth} — {settings.lastRunCount} Projekt{settings.lastRunCount !== 1 ? 'e' : ''} &middot; {lastRunFormatted}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: '#6b7280' }}>Noch kein Abschluss durchgeführt.</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          type="button"
          className="btn"
          disabled={runMut.isPending}
          onClick={() => { setRunMsg(null); runMut.mutate() }}
        >
          {runMut.isPending ? 'Wird ausgeführt …' : 'Jetzt ausführen (Test)'}
        </button>

        {settings?.lastRunMonth && (
          <button
            type="button"
            className="btn"
            onClick={handlePdf}
          >
            Bericht aufrufen
          </button>
        )}
      </div>

      {runMsg && (
        <Message type={runMsg.type} text={runMsg.text} />
      )}
    </div>
  )
}

// ── Arbeitszeitmodelle ────────────────────────────────────────────────────────

const EMPTY_WTM_FORM: WorkingTimeModelPayload = {
  name: '', country_code: 'DE', state_code: null,
  mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0,
  model_type: 'FIXED', break_rule_id: null,
  max_daily_hours: 10, min_rest_hours: 11, is_minor_profile: false,
}

const WTM_TEMPLATES = [
  { label: 'Vollzeit 40h (Mo–Fr)', values: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 } },
  { label: 'Teilzeit 20h (Mo–Fr)', values: { mon: 4, tue: 4, wed: 4, thu: 4, fri: 4, sat: 0, sun: 0 } },
  { label: '4-Tage 32h (Mo–Do)',   values: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 0, sat: 0, sun: 0 } },
  { label: 'Teilzeit 30h (Mo–Fr)', values: { mon: 6, tue: 6, wed: 6, thu: 6, fri: 6, sat: 0, sun: 0 } },
]

function WtmHourRow({ form, onChange }: {
  form: WorkingTimeModelPayload
  onChange: (k: keyof WorkingTimeModelPayload, v: string | number | boolean | null) => void
}) {
  const days: Array<{ key: keyof WorkingTimeModelPayload; label: string }> = [
    { key: 'mon', label: 'Mo' }, { key: 'tue', label: 'Di' },
    { key: 'wed', label: 'Mi' }, { key: 'thu', label: 'Do' },
    { key: 'fri', label: 'Fr' }, { key: 'sat', label: 'Sa' },
    { key: 'sun', label: 'So' },
  ]
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {days.map(d => (
        <div key={d.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{d.label}</label>
          <input
            type="number" min={0} max={24} step={0.5}
            style={{ width: 54, textAlign: 'center', fontSize: 13 }}
            value={form[d.key] as number}
            onChange={e => onChange(d.key, parseFloat(e.target.value) || 0)}
          />
        </div>
      ))}
    </div>
  )
}

function ArbeitszeitmodelleSection() {
  const qc  = useQueryClient()
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<WorkingTimeModelPayload>({ ...EMPTY_WTM_FORM })

  const { data: modelsRes }    = useQuery({ queryKey: ['working-time-models'],   queryFn: fetchWorkingTimeModels })
  const { data: statesRes }    = useQuery({ queryKey: ['country-states'],        queryFn: fetchCountryStates })
  const { data: brulesRes }    = useQuery({ queryKey: ['break-rules'],           queryFn: fetchBreakRules })

  const models: WorkingTimeModel[] = modelsRes?.data ?? []
  const countryStates: Record<string, CountryState[]> = statesRes?.data ?? {}
  const breakRules: BreakRule[] = brulesRes?.data ?? []

  const statesForCountry: CountryState[] = countryStates[form.country_code] ?? []

  function setField(k: keyof WorkingTimeModelPayload, v: string | number | boolean | null) {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (k === 'country_code') next.state_code = null
      return next
    })
  }

  function applyTemplate(t: typeof WTM_TEMPLATES[0]) {
    setForm(f => ({ ...f, ...t.values }))
  }

  function resetForm() {
    setForm({ ...EMPTY_WTM_FORM }); setShowForm(false); setEditingId(null)
  }

  const createMut = useMutation({
    mutationFn: () => createWorkingTimeModel(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['working-time-models'] })
      setMsg({ text: 'Modell gespeichert ✅', type: 'success' }); resetForm()
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const updateMut = useMutation({
    mutationFn: () => updateWorkingTimeModel(editingId!, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['working-time-models'] })
      setMsg({ text: 'Modell aktualisiert ✅', type: 'success' }); resetForm()
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWorkingTimeModel(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['working-time-models'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function startEdit(m: WorkingTimeModel) {
    setEditingId(m.ID)
    setForm({
      name: m.NAME, country_code: m.COUNTRY_CODE, state_code: m.STATE_CODE,
      mon: m.MON, tue: m.TUE, wed: m.WED, thu: m.THU, fri: m.FRI, sat: m.SAT, sun: m.SUN,
      model_type:       m.MODEL_TYPE       ?? 'FIXED',
      break_rule_id:    m.BREAK_RULE_ID    ?? null,
      max_daily_hours:  m.MAX_DAILY_HOURS  ?? 10,
      min_rest_hours:   m.MIN_REST_HOURS   ?? 11,
      is_minor_profile: m.IS_MINOR_PROFILE ?? false,
    })
    setShowForm(true)
  }

  function getStateLabel(cc: string, sc: string | null) {
    if (!sc) return cc
    const states: CountryState[] = countryStates[cc] ?? []
    return states.find(s => s.code === sc)?.label ?? sc
  }

  const isPending = createMut.isPending || updateMut.isPending

  return (
    <div className="admin-section">
      <div className="admin-block">
        <h3 className="admin-block-title">Arbeitszeitmodelle</h3>
        <p className="admin-section-hint" style={{ marginBottom: 12 }}>
          Definiert die tägliche Soll-Arbeitszeit pro Wochentag. Wird Mitarbeitern zugewiesen.
        </p>

        {models.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '2px 8px 4px 0' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '2px 8px 4px 0' }}>Bundesland</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>Mo</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>Di</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>Mi</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>Do</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>Fr</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>Sa</th>
                <th style={{ textAlign: 'center', padding: '2px 4px 4px' }}>So</th>
                <th style={{ textAlign: 'right', padding: '2px 0 4px 4px' }}>h/Woche</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {models.map(m => {
                const weekHours = m.MON + m.TUE + m.WED + m.THU + m.FRI + m.SAT + m.SUN
                return (
                  <tr key={m.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '3px 8px 3px 0', fontWeight: 600 }}>{m.NAME}</td>
                    <td style={{ padding: '3px 8px 3px 0', color: '#374151' }}>{getStateLabel(m.COUNTRY_CODE, m.STATE_CODE)}</td>
                    {[m.MON, m.TUE, m.WED, m.THU, m.FRI, m.SAT, m.SUN].map((h, i) => (
                      <td key={i} style={{ textAlign: 'center', padding: '3px 4px', color: h === 0 ? '#d1d5db' : '#374151' }}>{h}</td>
                    ))}
                    <td style={{ textAlign: 'right', padding: '3px 0 3px 4px', fontVariantNumeric: 'tabular-nums', color: '#374151' }}>{weekHours}</td>
                    <td style={{ padding: '3px 0 3px 6px', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginRight: 2 }} onClick={() => startEdit(m)}>✎</button>
                      <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }} disabled={deleteMut.isPending} onClick={() => { setMsg(null); deleteMut.mutate(m.ID) }}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {models.length === 0 && <p className="empty-note" style={{ margin: '4px 0 12px' }}>Noch keine Modelle.</p>}

        {!showForm && (
          <button type="button" className="btn-small btn-save" onClick={() => { resetForm(); setShowForm(true) }}>
            + Neues Modell
          </button>
        )}

        {showForm && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
              {editingId ? 'Modell bearbeiten' : 'Neues Modell'}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {WTM_TEMPLATES.map(t => (
                <button key={t.label} type="button" className="btn-small" style={{ fontSize: 11 }} onClick={() => applyTemplate(t)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="form-row" style={{ marginBottom: 10 }}>
              <div className="form-group">
                <label>Name*</label>
                <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="z. B. Vollzeit BY" />
              </div>
              <div className="form-group">
                <label>Land*</label>
                <select value={form.country_code} onChange={e => setField('country_code', e.target.value)}>
                  <option value="DE">Deutschland</option>
                  <option value="AT">Österreich</option>
                  <option value="CH">Schweiz</option>
                </select>
              </div>
              <div className="form-group">
                <label>Bundesland</label>
                <select value={form.state_code ?? ''} onChange={e => setField('state_code', e.target.value || null)}>
                  <option value="">— gesamtes Land —</option>
                  {statesForCountry.filter(s => s.code !== null).map(s => (
                    <option key={s.code!} value={s.code!}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Stunden pro Tag</div>
              <WtmHourRow form={form} onChange={setField} />
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: 600 }}>
                ArbZG-Rahmen
              </div>
              <div className="form-row" style={{ marginBottom: 8 }}>
                <div className="form-group">
                  <label>Modelltyp</label>
                  <select value={form.model_type ?? 'FIXED'} onChange={e => setField('model_type', e.target.value)}>
                    <option value="FIXED">Fest (Soll wird angezeigt)</option>
                    <option value="TRUST">Vertrauensarbeitszeit (Soll wird ausgeblendet)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Pausenregel</label>
                  <select value={form.break_rule_id ?? ''} onChange={e => setField('break_rule_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Tenant-Standard —</option>
                    {breakRules.map(br => (
                      <option key={br.ID} value={br.ID}>
                        {br.NAME} ({br.T1_HOURS}h → {br.T1_BREAK_MIN}min, {br.T2_HOURS}h → {br.T2_BREAK_MIN}min)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 8 }}>
                <div className="form-group">
                  <label>Max. Tagesarbeit (h)</label>
                  <input type="number" min={1} max={24} step={0.5}
                    value={form.max_daily_hours ?? 10}
                    onChange={e => setField('max_daily_hours', parseFloat(e.target.value) || 10)} />
                </div>
                <div className="form-group">
                  <label>Mindest-Ruhezeit (h)</label>
                  <input type="number" min={1} max={24} step={0.5}
                    value={form.min_rest_hours ?? 11}
                    onChange={e => setField('min_rest_hours', parseFloat(e.target.value) || 11)} />
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.is_minor_profile}
                    onChange={e => setField('is_minor_profile', e.target.checked)} />
                  <span>Jugendarbeitsschutz (U18-Profil) — 8 h/Tag, 12 h Ruhezeit</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-small btn-save" disabled={isPending || !form.name.trim()} onClick={() => { setMsg(null); editingId ? updateMut.mutate() : createMut.mutate() }}>
                {isPending ? '…' : editingId ? 'Speichern' : 'Anlegen'}
              </button>
              <button type="button" className="btn-small" onClick={resetForm}>Abbrechen</button>
            </div>
          </div>
        )}
      </div>

      <Message text={msg?.text ?? null} type={msg?.type} />
    </div>
  )
}

// ── Kostensatz-Rechner ────────────────────────────────────────────────────────

const FMT_EUR_KS = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
const FMT_H_KS   = (n: number) => n.toFixed(2).replace('.', ',') + ' h'
const FMT_PCT_KS = (n: number) => n.toFixed(1).replace('.', ',') + ' %'

const OVERHEAD_CATEGORIES = [
  'Miete/Nebenkosten', 'IT/Software', 'Versicherungen', 'Kfz-Kosten',
  'Werbung/Marketing', 'Büromaterial', 'AfA/Abschreibungen', 'Buchhaltung/Recht', 'Sonstiges',
]

const EMPTY_PARAMS: EmployeeCalcParams = {
  annual_salary: 0, weekly_hours: 40, vacation_days: 30,
  sick_days_est: 7, training_days: 5, social_contrib_pct: 21, productivity_pct: 85,
}

function KostensatzSection() {
  const qc   = useQueryClient()
  const year = new Date().getFullYear()
  const [selYear,       setSelYear]       = useState(year)
  const [overheadItems, setOverheadItems] = useState<OverheadItem[]>([])
  const [newCat,        setNewCat]        = useState(OVERHEAD_CATEGORIES[0])
  const [newName,       setNewName]       = useState('')
  const [newAmt,        setNewAmt]        = useState('')
  const [overheadMsg,   setOverheadMsg]   = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [empParams,     setEmpParams]     = useState<Record<number, EmployeeCalcParams & { dirty: boolean }>>({})
  const [paramsMsg,     setParamsMsg]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [markup,        setMarkup]        = useState('0')
  const [calcResults,   setCalcResults]   = useState<CalcResult[]>([])
  const [calcLoading,   setCalcLoading]   = useState(false)
  const [calcMsg,       setCalcMsg]       = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [hasCalculated, setHasCalculated] = useState(false)
  const [expanded,      setExpanded]      = useState<Set<number>>(new Set())
  const [selected,      setSelected]      = useState<Set<number>>(new Set())
  const [importDate,      setImportDate]      = useState('')
  const [importLoading,   setImportLoading]   = useState(false)
  const [showImport,      setShowImport]      = useState(false)
  const [recalcBookings,  setRecalcBookings]  = useState(false)

  const { data: empListData } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployeeList })
  const employees = empListData?.data?.filter(e => e.ACTIVE !== 2) ?? []

  // Load overhead
  const { data: overheadData, refetch: refetchOverhead } = useQuery({
    queryKey: ['kostensatz-overhead', selYear],
    queryFn:  () => fetchOverhead(selYear),
  })
  useEffect(() => {
    setOverheadItems(overheadData?.data ?? [])
  }, [overheadData?.data])

  // Load employee params when year or employee list changes
  useEffect(() => {
    if (!employees.length) return
    const init: Record<number, EmployeeCalcParams & { dirty: boolean }> = {}
    Promise.all(employees.map(async emp => {
      try {
        const res = await fetchEmployeeParams(emp.ID, selYear)
        init[emp.ID] = { ...res.data, dirty: false }
      } catch {
        init[emp.ID] = { ...EMPTY_PARAMS, dirty: false }
      }
    })).then(() => setEmpParams(init))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selYear, employees.length])

  function updateParam(empId: number, field: keyof EmployeeCalcParams, value: string) {
    setEmpParams(prev => ({
      ...prev,
      [empId]: { ...prev[empId], [field]: Number(value) || 0, dirty: true },
    }))
  }

  // Overhead helpers
  async function persistOverhead(items: OverheadItem[]) {
    try {
      await saveOverhead(selYear, items)
      await refetchOverhead()
    } catch (e: unknown) { setOverheadMsg({ text: (e as Error).message, type: 'error' }) }
  }

  async function addOverheadRow() {
    if (!newName.trim()) return
    const newItem: OverheadItem = { category: newCat, item_name: newName.trim(), amount: parseFloat(newAmt) || 0 }
    const next = [...overheadItems, newItem]
    setOverheadItems(next)
    setNewName(''); setNewAmt('')
    await persistOverhead(next)
  }

  async function removeOverhead(i: number) {
    const next = overheadItems.filter((_, idx) => idx !== i)
    setOverheadItems(next)
    await persistOverhead(next)
  }

  function updateOverhead(i: number, field: keyof OverheadItem, val: string) {
    setOverheadItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: field === 'amount' ? parseFloat(val) || 0 : val } : item))
  }

  const totalOverhead = overheadItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)

  async function saveOverheadClick() {
    setOverheadMsg(null)
    try {
      await saveOverhead(selYear, overheadItems)
      await refetchOverhead()
      setOverheadMsg({ text: 'Gemeinkosten gespeichert', type: 'success' })
    } catch (e: unknown) { setOverheadMsg({ text: (e as Error).message, type: 'error' }) }
  }

  async function copyFromPrevYear() {
    try {
      await copyOverheadFromYear(selYear - 1, selYear)
      await refetchOverhead()
      setOverheadMsg({ text: `Aus ${selYear - 1} kopiert`, type: 'success' })
    } catch (e: unknown) { setOverheadMsg({ text: (e as Error).message, type: 'error' }) }
  }

  async function saveAllParams() {
    setParamsMsg(null)
    const dirty = employees
      .filter(e => empParams[e.ID]?.dirty)
      .map(e => ({ employee_id: e.ID, ...empParams[e.ID] }))
    if (!dirty.length) { setParamsMsg({ text: 'Keine Änderungen', type: 'success' }); return }
    try {
      await saveEmployeeParamsBulk(selYear, dirty)
      setEmpParams(prev => {
        const next = { ...prev }
        dirty.forEach(d => { if (next[d.employee_id]) next[d.employee_id].dirty = false })
        return next
      })
      setParamsMsg({ text: `${dirty.length} Mitarbeiter gespeichert`, type: 'success' })
    } catch (e: unknown) { setParamsMsg({ text: (e as Error).message, type: 'error' }) }
  }

  async function runCalculation() {
    setCalcMsg(null); setCalcLoading(true); setCalcResults([]); setHasCalculated(false)
    try {
      const res = await calculateRates({ year: selYear, profit_markup_pct: parseFloat(markup) || 0 })
      setCalcResults(res.data)
      setHasCalculated(true)
      setSelected(new Set(res.data.map(r => r.employee_id)))
      if (!res.data.length) setCalcMsg({ text: 'Keine aktiven Mitarbeiter für dieses Jahr gefunden.', type: 'error' })
    } catch (e: unknown) { setCalcMsg({ text: (e as Error).message, type: 'error' }); setHasCalculated(true) }
    finally { setCalcLoading(false) }
  }

  async function doImport() {
    if (!importDate) return
    setImportLoading(true)
    try {
      const rates = calcResults
        .filter(r => selected.has(r.employee_id))
        .map(r => ({ employee_id: r.employee_id, rate: r.breakdown.import_rate }))
      await importRates(rates, importDate, recalcBookings)
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['emp-cp-rates'] })
      const recalcNote = recalcBookings ? ' · Buchungen neu berechnet' : ''
      setCalcMsg({ text: `${rates.length} Kostensätze übernommen (gültig ab ${importDate})${recalcNote}`, type: 'success' })
      setShowImport(false); setImportDate(''); setSelected(new Set()); setRecalcBookings(false)
    } catch (e: unknown) { setCalcMsg({ text: (e as Error).message, type: 'error' }) }
    finally { setImportLoading(false) }
  }

  function toggleExpand(id: number) { setExpanded(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleSelect(id: number) { setSelected(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  const diffColor = (cur: number | null, calc: number) => {
    if (cur == null || cur === 0) return '#6b7280'
    const pct = (calc - cur) / cur * 100
    if (pct > 10) return '#dc2626'
    if (pct > 0)  return '#d97706'
    return '#059669'
  }

  return (
    <div>
      {/* Year selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Kalkulationsjahr</span>
        <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} style={{ fontSize: 14, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)' }}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Panel 1: Gemeinkosten */}
      <div className="master-section-block" style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Gemeinkosten {selYear}</h3>
          <button type="button" className="btn-small" onClick={copyFromPrevYear}>
            Aus {selYear - 1} kopieren
          </button>
        </div>
        {overheadMsg && <Message text={overheadMsg.text} type={overheadMsg.type} />}

        <table className="master-table" style={{ fontSize: 13, marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Kategorie</th>
              <th>Bezeichnung</th>
              <th style={{ textAlign: 'right' }}>Betrag/Jahr</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {overheadItems.length === 0 && (
              <tr><td colSpan={4} className="empty-note" style={{ padding: '8px 0' }}>Noch keine Positionen — füge unten welche hinzu.</td></tr>
            )}
            {overheadItems.map((item, i) => (
              <tr key={i}>
                <td>
                  <select value={item.category} onChange={e => updateOverhead(i, 'category', e.target.value)} style={{ fontSize: 12, padding: '2px 4px', border: '1px solid var(--border-2)', borderRadius: 4, background: 'var(--surface)' }}>
                    {OVERHEAD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td>
                  <input value={item.item_name} onChange={e => updateOverhead(i, 'item_name', e.target.value)} style={{ fontSize: 12, padding: '2px 6px', border: '1px solid var(--border-2)', borderRadius: 4, background: 'var(--surface)', width: '100%' }} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" value={item.amount} onChange={e => updateOverhead(i, 'amount', e.target.value)} style={{ fontSize: 12, padding: '2px 6px', border: '1px solid var(--border-2)', borderRadius: 4, background: 'var(--surface)', width: 110, textAlign: 'right' }} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn-icon-danger" onClick={() => removeOverhead(i)} title="Löschen">×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sum-row">
              <td colSpan={2}><strong>Gesamt</strong></td>
              <td style={{ textAlign: 'right' }}><strong>{FMT_EUR_KS.format(totalOverhead)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        {/* Add row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 2 }}>Kategorie</label>
            <select value={newCat} onChange={e => setNewCat(e.target.value)} style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border-2)', borderRadius: 5, background: 'var(--surface)' }}>
              {OVERHEAD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 2 }}>Bezeichnung</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="z.B. Serverkosten" style={{ fontSize: 13, padding: '4px 8px', border: '1px solid var(--border-2)', borderRadius: 5, background: 'var(--surface)', width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 2 }}>Betrag €/Jahr</label>
            <input type="number" value={newAmt} onChange={e => setNewAmt(e.target.value)} placeholder="0" style={{ fontSize: 13, padding: '4px 8px', border: '1px solid var(--border-2)', borderRadius: 5, background: 'var(--surface)', width: 120, textAlign: 'right' }} />
          </div>
          <button type="button" className="btn-small btn-save" onClick={addOverheadRow} style={{ alignSelf: 'flex-end' }}>+ Hinzufügen</button>
          <button type="button" className="btn-small" onClick={saveOverheadClick} style={{ alignSelf: 'flex-end' }} title="Änderungen an bestehenden Positionen speichern">Speichern</button>
        </div>
      </div>

      {/* Panel 2: Mitarbeiter-Parameter */}
      <div className="master-section-block" style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Mitarbeiter-Parameter {selYear}</h3>
          <button type="button" className="btn-small btn-save" onClick={saveAllParams}>Alle speichern</button>
        </div>
        {paramsMsg && <Message text={paramsMsg.text} type={paramsMsg.type} />}
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, marginTop: 0 }}>
          AG-Sozialabgaben (D): KV (Krankenversicherung) ~7,3% · RV (Rentenversicherung) 9,3% · AV (Arbeitslosenversicherung) 1,5% · PV (Pflegeversicherung) ~1,8% · UV (Unfallversicherung) ~1% ≈ 21% gesamt
        </p>
        <div className="table-scroll">
          <table className="master-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Kürzel</th>
                <th>Jahresgehalt (brutto)</th>
                <th style={{ textAlign: 'right' }}>Wochenstd.</th>
                <th style={{ textAlign: 'right' }}>Urlaub</th>
                <th style={{ textAlign: 'right' }}>Krank</th>
                <th style={{ textAlign: 'right' }}>Weiterbild.</th>
                <th style={{ textAlign: 'right' }}>AG-SV %</th>
                <th style={{ textAlign: 'right' }}>Produktiv %</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const p = empParams[emp.ID]
                if (!p) return <tr key={emp.ID}><td colSpan={8} style={{ color: 'var(--text-4)', fontSize: 11 }}>Laden…</td></tr>
                const inp = (field: keyof EmployeeCalcParams, w = 70) => (
                  <input
                    type="number"
                    value={p[field]}
                    onChange={e => updateParam(emp.ID, field, e.target.value)}
                    style={{ width: w, padding: '2px 4px', fontSize: 12, border: '1px solid var(--border-2)', borderRadius: 4, background: 'var(--surface)', textAlign: 'right' }}
                  />
                )
                return (
                  <tr key={emp.ID} style={{ background: p.dirty ? 'var(--dim)' : undefined }}>
                    <td><strong>{emp.SHORT_NAME}</strong></td>
                    <td>{inp('annual_salary', 110)}</td>
                    <td style={{ textAlign: 'right' }}>{inp('weekly_hours', 60)}</td>
                    <td style={{ textAlign: 'right' }}>{inp('vacation_days', 55)}</td>
                    <td style={{ textAlign: 'right' }}>{inp('sick_days_est', 55)}</td>
                    <td style={{ textAlign: 'right' }}>{inp('training_days', 55)}</td>
                    <td style={{ textAlign: 'right' }}>{inp('social_contrib_pct', 60)}</td>
                    <td style={{ textAlign: 'right' }}>{inp('productivity_pct', 60)}</td>
                  </tr>
                )
              })}
              {employees.length === 0 && (
                <tr><td colSpan={8} className="empty-note">Keine aktiven Mitarbeiter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel 3: Kalkulation */}
      <div className="master-section-block">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Kalkulation & Ergebnis</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Gewinnaufschlag
              <input
                type="number" value={markup} onChange={e => setMarkup(e.target.value)} min={0} max={100} step={0.5}
                style={{ width: 60, padding: '4px 6px', fontSize: 13, border: '1px solid var(--border-2)', borderRadius: 5, background: 'var(--surface)', textAlign: 'right' }}
              />
              %
            </label>
            <button type="button" className="btn-small btn-save" onClick={runCalculation} disabled={calcLoading}>
              {calcLoading ? 'Berechne…' : 'Berechnen'}
            </button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12, marginTop: 0, lineHeight: 1.6 }}>
          <strong>Formel:</strong>{' '}
          Arbeitstage = 365 − 104 (Wochenenden) − Feiertage − Urlaubstage − Krankheitstage − Weiterbildungstage
          {' · '}
          Nettostunden = Arbeitstage × (Wochenstd. / 5) × Produktivität%
          {' · '}
          Direktkosten/h = Jahresgehalt × (1 + AG-SV%) ÷ Nettostunden
          {' · '}
          Gemeinkosten/h = (Gesamtgemeinkosten × Nettostunden-Anteil) ÷ Nettostunden
          {' · '}
          <strong>Vollkostensatz = Direktkosten/h + Gemeinkosten/h</strong>
          {' · '}
          Importrate = Vollkostensatz × (1 + Gewinnaufschlag%)
        </p>
        {calcMsg && <Message text={calcMsg.text} type={calcMsg.type} />}

        {calcResults.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="master-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 24 }}></th>
                    <th>Mitarbeiter</th>
                    <th style={{ textAlign: 'right' }}>Nettostunden</th>
                    <th style={{ textAlign: 'right' }}>Direktkosten/h</th>
                    <th style={{ textAlign: 'right' }}>Gemeinkosten/h</th>
                    <th style={{ textAlign: 'right' }}>Vollkostensatz</th>
                    {parseFloat(markup) > 0 && <th style={{ textAlign: 'right' }}>Importrate</th>}
                    <th style={{ textAlign: 'right' }}>Aktueller Satz</th>
                    <th style={{ textAlign: 'right' }}>Diff.</th>
                    <th style={{ width: 32, textAlign: 'center' }}>
                      <input type="checkbox"
                        checked={selected.size === calcResults.length}
                        onChange={e => setSelected(e.target.checked ? new Set(calcResults.map(r => r.employee_id)) : new Set())}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calcResults.map(r => {
                    const bd   = r.breakdown
                    const imp  = parseFloat(markup) > 0
                    const rate = imp ? bd.import_rate : bd.vollkostensatz
                    const diff = r.current_cp_rate != null && r.current_cp_rate > 0
                      ? ((rate - r.current_cp_rate) / r.current_cp_rate * 100) : null
                    const isExp = expanded.has(r.employee_id)
                    return (
                      <Fragment key={r.employee_id}>
                        <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(r.employee_id)}>
                          <td style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 10 }}>{isExp ? '▼' : '▶'}</td>
                          <td><strong>{r.short_name}</strong> <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>{r.first_name} {r.last_name}</span></td>
                          <td style={{ textAlign: 'right' }}>{FMT_H_KS(bd.productive_hours)}</td>
                          <td style={{ textAlign: 'right' }}>{FMT_EUR_KS.format(bd.direct_cost_per_h)}</td>
                          <td style={{ textAlign: 'right' }}>{FMT_EUR_KS.format(bd.overhead_per_h)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{FMT_EUR_KS.format(bd.vollkostensatz)}</td>
                          {imp && <td style={{ textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>{FMT_EUR_KS.format(bd.import_rate)}</td>}
                          <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.current_cp_rate != null ? FMT_EUR_KS.format(r.current_cp_rate) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: diffColor(r.current_cp_rate, rate) }}>
                            {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')} %` : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(r.employee_id)} onChange={() => toggleSelect(r.employee_id)} />
                          </td>
                        </tr>
                        {isExp && (
                          <tr key={`${r.employee_id}-detail`} style={{ background: 'var(--dim)' }}>
                            <td></td>
                            <td colSpan={9}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 24px', padding: '8px 0', fontSize: 12, color: 'var(--text-2)' }}>
                                <span>📅 Arbeitstage: <strong>{bd.working_days}</strong></span>
                                <span>🏖 Feiertage: <strong>{bd.public_holidays}</strong></span>
                                <span>⏱ Nettostunden: <strong>{FMT_H_KS(bd.productive_hours)}</strong></span>
                                <span>💶 Bruttogehalt: <strong>{FMT_EUR_KS.format(bd.annual_salary)}</strong></span>
                                <span>🔒 AG-Sozialabgaben: <strong>{FMT_EUR_KS.format(bd.social_contrib_eur)}</strong></span>
                                <span>= Direktkosten/Jahr: <strong>{FMT_EUR_KS.format(bd.direct_cost_total)}</strong></span>
                                <span>🏢 Gesamtgemeinkosten: <strong>{FMT_EUR_KS.format(bd.overhead_total)}</strong></span>
                                <span>📊 Anteil: <strong>{FMT_PCT_KS(bd.overhead_share_pct)}</strong></span>
                                <span>= Gemeinkosten zugeteilt: <strong>{FMT_EUR_KS.format(bd.overhead_allocated)}</strong></span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{selected.size} von {calcResults.length} ausgewählt</span>
                {!showImport && (
                  <button type="button" className="btn-small btn-save" onClick={() => setShowImport(true)} disabled={!selected.size}>
                    Ausgewählte als Kostensatz übernehmen …
                  </button>
                )}
              </div>
              {showImport && (
                <div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--dim)', border: '1px solid var(--border-2)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--text-2)' }}>Gültig ab</span>
                      <input type="date" value={importDate} onChange={e => setImportDate(e.target.value)}
                        style={{ fontSize: 13, padding: '4px 8px', border: '1px solid var(--border-2)', borderRadius: 5, background: 'var(--surface)' }} />
                    </label>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 14 }}>
                    <input type="checkbox" checked={recalcBookings} onChange={e => setRecalcBookings(e.target.checked)}
                      style={{ marginTop: 2, width: 15, height: 15, flexShrink: 0 }} />
                    <span>
                      <strong>Bestehende Buchungen (TEC) neu berechnen</strong>
                      <span style={{ color: 'var(--text-3)', display: 'block', fontSize: 12, marginTop: 2 }}>
                        Alle Buchungen ab dem gewählten Datum werden mit dem neuen Kostensatz (CP_RATE) und dem
                        daraus resultierenden CP_TOT neu berechnet. Buchungen vor diesem Datum bleiben unverändert.
                      </span>
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className="btn-small btn-save" onClick={doImport} disabled={!importDate || importLoading || !selected.size}>
                      {importLoading ? 'Speichere…' : `${selected.size} Kostensätze${recalcBookings ? ' + Buchungen' : ''} übernehmen`}
                    </button>
                    <button type="button" className="btn-small" onClick={() => { setShowImport(false); setRecalcBookings(false) }}>Abbrechen</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {!calcLoading && calcResults.length === 0 && !hasCalculated && (
          <p className="empty-note">Gemeinkosten und Mitarbeiter-Parameter eingeben, dann „Berechnen" klicken.</p>
        )}
      </div>
    </div>
  )
}

// ── Mahnungseinstellungen ─────────────────────────────────────────────────────

function MahnungsEinstellungenSection() {
  const qc = useQueryClient()
  const { data: raw, isLoading } = useQuery({ queryKey: ['mahnung-settings'], queryFn: () => fetchMahnungSettings().then(r => r.data) })

  const [levels, setLevels] = useState<MahnungSettingsLevel[]>([])
  const [msg,    setMsg]    = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { if (raw) setLevels(raw) }, [raw])

  const saveMut = useMutation({
    mutationFn: () => saveMahnungSettings(levels),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['mahnung-settings'] }); setMsg({ type: 'ok', text: 'Einstellungen gespeichert.' }) },
    onError:    (e: Error) => setMsg({ type: 'err', text: e.message }),
  })

  useCtrlS(() => saveMut.mutate(), true)

  function update(i: number, field: keyof MahnungSettingsLevel, value: string | number | null) {
    setLevels(lv => lv.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
    setMsg(null)
  }

  if (isLoading) return <p className="empty-note">Lade…</p>

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Konfigurieren Sie Bezeichnungen, Gebühren und Texte für jede Mahnstufe. Diese Einstellungen gelten für alle Mahnungs-PDFs.
      </p>

      {levels.map((lv, i) => (
        <div key={lv.mahnstufe} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: 'var(--accent)' }}>
            Stufe {lv.mahnstufe}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Bezeichnung</label>
              <input type="text" className="form-control" value={lv.label} onChange={e => update(i, 'label', e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Mahngebühr (€)</label>
              <input type="number" className="form-control" value={lv.fee} min={0} step={0.01} onChange={e => update(i, 'fee', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{lv.mahnstufe === 1 ? 'Tage nach Fälligkeit' : 'Tage nach vorheriger Mahnung'}</label>
              <input type="number" className="form-control" value={lv.mahnstufe === 1 ? lv.daysAfterDue : lv.daysAfterPrev} min={0}
                onChange={e => update(i, lv.mahnstufe === 1 ? 'daysAfterDue' : 'daysAfterPrev', parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="form-group" style={{ margin: '0 0 8px' }}>
            <label className="form-label">Kopftext (erscheint vor der Rechnungstabelle)</label>
            <textarea className="form-control" rows={3} value={lv.headerText ?? ''} onChange={e => update(i, 'headerText', e.target.value || null)} placeholder="Optional…" />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Fußtext (erscheint nach der Rechnungstabelle)</label>
            <textarea className="form-control" rows={3} value={lv.footerText ?? ''} onChange={e => update(i, 'footerText', e.target.value || null)} placeholder="Optional…" />
          </div>
        </div>
      ))}

      {msg && <Message type={msg.type === 'ok' ? 'success' : 'error'} text={msg.text} />}
      <button className="btn btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} style={{ marginTop: 8 }}>
        {saveMut.isPending ? 'Speichern…' : 'Einstellungen speichern'}
      </button>
      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>oder Strg+S</span>
    </div>
  )
}

// ── Textvorlagen ──────────────────────────────────────────────────────────────

function TextVorlagenSection() {
  const qc = useQueryClient()
  const { data: raw, isLoading } = useQuery({ queryKey: ['text-templates'], queryFn: () => fetchTextTemplates().then(r => r.data) })

  const types = Object.keys(TEXT_TEMPLATE_LABELS) as TextTemplateType[]
  const [activeType, setActiveType] = useState<TextTemplateType>('invoice_abschlags')
  const [drafts, setDrafts]         = useState<Record<string, TextTemplate>>({})
  const [msg, setMsg]               = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!raw) return
    const m: Record<string, TextTemplate> = {}
    for (const t of raw) m[t.documentType] = t
    setDrafts(m)
  }, [raw])

  const saveMut = useMutation({
    mutationFn: () => saveTextTemplate(activeType, {
      headerText: drafts[activeType]?.headerText ?? null,
      footerText: drafts[activeType]?.footerText ?? null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['text-templates'] }); setMsg({ type: 'ok', text: 'Gespeichert.' }) },
    onError:   (e: Error) => setMsg({ type: 'err', text: e.message }),
  })

  useCtrlS(() => saveMut.mutate(), true)

  function updateDraft(field: 'headerText' | 'footerText', value: string) {
    setDrafts(d => ({ ...d, [activeType]: { ...d[activeType], documentType: activeType, [field]: value || null } }))
    setMsg(null)
  }

  const current = drafts[activeType] ?? { documentType: activeType, headerText: null, footerText: null }

  if (isLoading) return <p className="empty-note">Lade…</p>

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Hinterlegen Sie Standardtexte für Rechnungs-PDFs. Diese erscheinen als Kopf- und Fußtext auf dem Dokument,
        sofern beim Erstellen der Rechnung kein eigener Text eingetragen wurde.
      </p>

      {/* Type selector */}
      <div className="text-template-types">
        {types.map(t => (
          <button
            key={t}
            className={`text-template-type-btn${activeType === t ? ' active' : ''}`}
            onClick={() => { setActiveType(t); setMsg(null) }}
          >
            {TEXT_TEMPLATE_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="form-group">
        <label className="form-label">Kopftext (text1 — erscheint vor der Positionstabelle)</label>
        <textarea
          className="form-control"
          rows={5}
          value={current.headerText ?? ''}
          onChange={e => updateDraft('headerText', e.target.value)}
          placeholder="Optional. z.B. Anrede, Hinweistext…"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Fußtext (text2 — erscheint nach der Positionstabelle)</label>
        <textarea
          className="form-control"
          rows={5}
          value={current.footerText ?? ''}
          onChange={e => updateDraft('footerText', e.target.value)}
          placeholder="Optional. z.B. Zahlungshinweis, Bankdaten, Grußformel…"
        />
      </div>

      {msg && <Message type={msg.type === 'ok' ? 'success' : 'error'} text={msg.text} />}
      <button className="btn btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
        {saveMut.isPending ? 'Speichern…' : 'Textvorlage speichern'}
      </button>
      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>oder Strg+S</span>
    </div>
  )
}

// ── Pausenregeln ──────────────────────────────────────────────────────────────

const EMPTY_BR_FORM = {
  id: undefined as number | undefined,
  name: '', t1_hours: 6, t1_break_min: 30, t2_hours: 9, t2_break_min: 45, min_block_min: 15,
}

function PausenregelnSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_BR_FORM })

  const { data: rulesRes, isLoading } = useQuery({ queryKey: ['break-rules'], queryFn: fetchBreakRules })
  const rules: BreakRule[] = rulesRes?.data ?? []

  const upsertMut = useMutation({
    mutationFn: () => upsertBreakRule(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['break-rules'] })
      toast.success(form.id ? 'Pausenregel aktualisiert' : 'Pausenregel angelegt')
      setShowForm(false); setForm({ ...EMPTY_BR_FORM })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteBreakRule(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['break-rules'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  function startEdit(r: BreakRule) {
    setForm({
      id: r.ID, name: r.NAME,
      t1_hours: Number(r.T1_HOURS), t1_break_min: Number(r.T1_BREAK_MIN),
      t2_hours: Number(r.T2_HOURS), t2_break_min: Number(r.T2_BREAK_MIN),
      min_block_min: Number(r.MIN_BLOCK_MIN),
    })
    setShowForm(true)
  }

  return (
    <div className="admin-section">
      <div className="admin-block">
        <h3 className="admin-block-title">Pausenregeln</h3>
        <p className="admin-section-hint" style={{ marginBottom: 12 }}>
          Definiert ab welcher Tagesarbeitszeit wie viel Pflichtpause gilt (§ 4 ArbZG).
          Pro Arbeitszeitmodell zuweisbar; "Tenant-Standard" gilt fallweise.
        </p>

        {isLoading && <p className="empty-note">Lade…</p>}

        {!isLoading && rules.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '2px 8px 4px 0' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '2px 8px 4px 0' }}>ab Std.</th>
                <th style={{ textAlign: 'right', padding: '2px 8px 4px 0' }}>Pause</th>
                <th style={{ textAlign: 'right', padding: '2px 8px 4px 0' }}>ab Std.</th>
                <th style={{ textAlign: 'right', padding: '2px 8px 4px 0' }}>Pause</th>
                <th style={{ textAlign: 'right', padding: '2px 8px 4px 0' }}>Min-Block</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '3px 8px 3px 0', fontWeight: 600 }}>{r.NAME}</td>
                  <td style={{ padding: '3px 8px 3px 0', textAlign: 'right' }}>{r.T1_HOURS}</td>
                  <td style={{ padding: '3px 8px 3px 0', textAlign: 'right' }}>{r.T1_BREAK_MIN} min</td>
                  <td style={{ padding: '3px 8px 3px 0', textAlign: 'right' }}>{r.T2_HOURS}</td>
                  <td style={{ padding: '3px 8px 3px 0', textAlign: 'right' }}>{r.T2_BREAK_MIN} min</td>
                  <td style={{ padding: '3px 8px 3px 0', textAlign: 'right' }}>{r.MIN_BLOCK_MIN} min</td>
                  <td style={{ padding: '3px 0 3px 6px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginRight: 2 }} onClick={() => startEdit(r)}>✎</button>
                    <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }} disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(r.ID)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLoading && rules.length === 0 && (
          <p className="empty-note" style={{ margin: '4px 0 12px' }}>
            Keine Pausenregeln. Migrationsstand prüfen — Phase 1 legt zwei Standardregeln pro Tenant an.
          </p>
        )}

        {!showForm && (
          <button type="button" className="btn-small btn-save"
            onClick={() => { setForm({ ...EMPTY_BR_FORM }); setShowForm(true) }}>
            + Neue Pausenregel
          </button>
        )}

        {showForm && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
              {form.id ? 'Pausenregel bearbeiten' : 'Neue Pausenregel'}
            </div>
            <div className="form-row" style={{ marginBottom: 8 }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label>Name*</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="z. B. Tarifvertrag XY" />
              </div>
              <div className="form-group">
                <label>Min-Block (min)</label>
                <input type="number" min={1} value={form.min_block_min}
                  onChange={e => setForm(f => ({ ...f, min_block_min: Number(e.target.value) || 15 }))} />
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 8 }}>
              <div className="form-group">
                <label>Schwelle 1 (h)</label>
                <input type="number" min={0} step={0.5} value={form.t1_hours}
                  onChange={e => setForm(f => ({ ...f, t1_hours: Number(e.target.value) || 0 }))} />
              </div>
              <div className="form-group">
                <label>Pause 1 (min)</label>
                <input type="number" min={0} value={form.t1_break_min}
                  onChange={e => setForm(f => ({ ...f, t1_break_min: Number(e.target.value) || 0 }))} />
              </div>
              <div className="form-group">
                <label>Schwelle 2 (h)</label>
                <input type="number" min={0} step={0.5} value={form.t2_hours}
                  onChange={e => setForm(f => ({ ...f, t2_hours: Number(e.target.value) || 0 }))} />
              </div>
              <div className="form-group">
                <label>Pause 2 (min)</label>
                <input type="number" min={0} value={form.t2_break_min}
                  onChange={e => setForm(f => ({ ...f, t2_break_min: Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-small btn-save"
                disabled={upsertMut.isPending || !form.name.trim()}
                onClick={() => upsertMut.mutate()}>
                {upsertMut.isPending ? '…' : form.id ? 'Speichern' : 'Anlegen'}
              </button>
              <button type="button" className="btn-small"
                onClick={() => { setShowForm(false); setForm({ ...EMPTY_BR_FORM }) }}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ArbZG-Einstellungen ───────────────────────────────────────────────────────

function ArbzgSettingsSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: settingsRes, isLoading } = useQuery({ queryKey: ['arbzg-settings'], queryFn: fetchArbzgSettings })
  const { data: brulesRes } = useQuery({ queryKey: ['break-rules'], queryFn: fetchBreakRules })
  const { data: statesRes } = useQuery({ queryKey: ['country-states'], queryFn: fetchCountryStates })

  const initial = settingsRes?.data
  const [form, setForm] = useState<Partial<ArbzgSettings>>({})

  useEffect(() => { if (initial) setForm({}) }, [initial])

  const merged: ArbzgSettings | null = initial
    ? { ...initial, ...form } as ArbzgSettings
    : null

  function set<K extends keyof ArbzgSettings>(k: K, v: ArbzgSettings[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const saveMut = useMutation({
    mutationFn: () => saveArbzgSettings(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['arbzg-settings'] })
      toast.success('ArbZG-Einstellungen gespeichert')
      setForm({})
    },
    onError: (e: Error) => toast.error(e.message),
  })

  useCtrlS(() => saveMut.mutate())

  if (isLoading || !merged) return <p className="empty-note">Lade…</p>

  const breakRules: BreakRule[] = brulesRes?.data ?? []
  const countryStates: Record<string, CountryState[]> = statesRes?.data ?? {}
  const states: CountryState[] = countryStates[merged.country] ?? []

  const Tog = ({ k, label, hint }: { k: keyof ArbzgSettings; label: string; hint?: string }) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '4px 0' }}>
      <input type="checkbox" style={{ marginTop: 3 }}
        checked={!!merged[k]}
        onChange={e => set(k, e.target.checked as ArbzgSettings[typeof k])} />
      <span>
        <span style={{ fontSize: 13, color: '#111827' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 11, color: '#6b7280', marginTop: 1 }}>{hint}</span>}
      </span>
    </label>
  )

  return (
    <div className="admin-section">
      <div className="admin-block" style={{ maxWidth: 720 }}>
        <h3 className="admin-block-title">ArbZG-Einstellungen</h3>
        <p className="admin-section-hint" style={{ marginBottom: 12 }}>
          Tenant-weite Konfiguration für die Stempeluhr-Prüfungen nach
          Arbeitszeitgesetz (BAG-Urteil vom 13.09.2022 + ArbZG-Reform 2026).
        </p>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px 12px', margin: '0 0 14px' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 6px' }}>Allgemein</legend>
          <Tog k="enabled"    label="ArbZG-Prüfung aktiv"
            hint="Master-Schalter. Deaktiviert alle nachstehenden Prüfungen, ohne dass die Konfiguration verloren geht." />
          <Tog k="strictMode" label="Strikter Modus"
            hint="Warnungen werden zu Blockaden — Buchungen, die ArbZG verletzen, werden abgewiesen." />
        </fieldset>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px 12px', margin: '0 0 14px' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 6px' }}>Prüfungen</legend>
          <Tog k="checkBreakRequired" label="Pflichtpause prüfen (§ 4 ArbZG)" />
          <Tog k="checkMaxDaily"      label="Tageshöchstarbeitszeit prüfen (§ 3 ArbZG)"
            hint="Wert pro Mitarbeiter über das Arbeitszeitmodell konfigurierbar (Default 10 h)." />
          <Tog k="checkMinRest"       label="11-Stunden-Ruhezeit prüfen (§ 5 ArbZG)"
            hint="JArbSchG-Profil verschärft automatisch auf 12 h." />
          <Tog k="checkSundayHoliday" label="Sonn- und Feiertagsarbeit sperren (§ 9 ArbZG)"
            hint="Architektur-/Planungsbüros fallen nicht unter § 10 — Buchungen werden geblockt." />
          <Tog k="checkAvg6m"         label="6-Monats-Ausgleichsperiode auswerten"
            hint="Nur Reporting — verhindert keine Buchung." />
        </fieldset>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px 12px', margin: '0 0 14px' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 6px' }}>Automatischer Pausenabzug</legend>
          <Tog k="autoBreakDeduct" label="Fehlende Pause beim Tagesabschluss abziehen"
            hint="Vermeidet, dass die Tagessumme höher gemeldet wird als rechtskonform." />
          <Tog k="autoBreakRequireConfirm" label="Mitarbeiter muss Auto-Abzug bestätigen"
            hint="BAG 2025: ein blinder Abzug ohne Bestätigung wäre als Lohnraub angreifbar. Empfohlen AN." />
        </fieldset>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px 12px', margin: '0 0 14px' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 6px' }}>Region</legend>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <div className="form-group">
              <label>Land</label>
              <select value={merged.country} onChange={e => { set('country', e.target.value); set('stateCode', null) }}>
                <option value="DE">Deutschland</option>
                <option value="AT">Österreich</option>
                <option value="CH">Schweiz</option>
              </select>
            </div>
            <div className="form-group">
              <label>Bundesland (Feiertage)</label>
              <select value={merged.stateCode ?? ''} onChange={e => set('stateCode', e.target.value || null)}>
                <option value="">— gesamtes Land —</option>
                {states.filter(s => s.code !== null).map(s => (
                  <option key={s.code!} value={s.code!}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Standard-Pausenregel</label>
              <select value={merged.defaultBreakRuleId ?? ''}
                onChange={e => set('defaultBreakRuleId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Inline-Default (6h/9h) —</option>
                {breakRules.map(br => <option key={br.ID} value={br.ID}>{br.NAME}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px 12px', margin: '0 0 14px' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 6px' }}>Hinweistext beim Tagesabschluss</legend>
          <textarea rows={4} style={{ width: '100%', fontSize: 12, padding: 8, fontFamily: 'inherit',
                                       border: '1px solid #d1d5db', borderRadius: 4 }}
            value={merged.legalTextBlock ?? ''}
            onChange={e => set('legalTextBlock', e.target.value)} />
        </fieldset>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-primary"
            disabled={saveMut.isPending || Object.keys(form).length === 0}
            onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Benachrichtigungen ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  invoice: 'Rechnungen',
  mahnung: 'Mahnungen',
  budget:  'Budget & Projekte',
  system:  'System',
}

const DASHBOARD_ROLE_LABELS: Record<string, string> = {
  geschaeftsleitung: 'Geschäftsleitung',
  controller:        'Controller',
  bereichsleiter:    'Bereichsleiter',
}

function BenachrichtigungenSection() {
  const qc = useQueryClient()
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['notification-configs'],
    queryFn:  fetchNotificationConfigs,
  })
  // Types mit dedizierter Schedule-UI (Block unten) sind aus der
  // generischen Liste ausgeblendet, damit es keine zwei Bedienorte gibt.
  const SCHEDULE_TYPES = new Set(['leistungsstand_reminder', 'hours_booking_reminder'])
  const configs = (data?.data ?? []).filter(c => !SCHEDULE_TYPES.has(c.typeKey))

  // Gruppieren nach Kategorie, sortiert nach SORT_ORDER innerhalb
  const grouped = configs.reduce<Record<string, NotificationTypeConfig[]>>((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c)
    return acc
  }, {})
  const categoryOrder = Object.keys(grouped).sort((a, b) => {
    const ra = grouped[a][0]?.sortOrder ?? 0
    const rb = grouped[b][0]?.sortOrder ?? 0
    return ra - rb
  })

  const toggleMut = useMutation({
    mutationFn: (vars: { typeKey: string; enabled: boolean; cur: NotificationTypeConfig }) =>
      upsertNotificationConfig(vars.typeKey, {
        enabled:             vars.enabled,
        audienceUseDefault:  vars.cur.audienceUseDefault,
        audienceAllTenant:   vars.cur.audienceAllTenant,
        audienceRoles:       vars.cur.audienceRoles,
        audienceDepartments: vars.cur.audienceDepartments,
        audienceEmployees:   vars.cur.audienceEmployees,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-configs'] }),
  })

  function summarizeAudience(c: NotificationTypeConfig): string {
    if (c.defaultAudienceKind === 'managed_by_rule') return 'Pro Regel / Datensatz konfiguriert'
    if (c.audienceUseDefault) return 'Tenant-Standard (alle Mitarbeiter)'
    if (c.audienceAllTenant)  return 'Alle Mitarbeiter'
    const parts: string[] = []
    if (c.audienceRoles?.length)       parts.push(`Rollen: ${c.audienceRoles.map(r => DASHBOARD_ROLE_LABELS[r] ?? r).join(', ')}`)
    if (c.audienceDepartments?.length) parts.push(`${c.audienceDepartments.length} Abteilung(en)`)
    if (c.audienceEmployees?.length)   parts.push(`${c.audienceEmployees.length} Mitarbeiter`)
    return parts.length ? parts.join(' · ') : 'Niemand (Empfaengerliste leer)'
  }

  if (isLoading) return <p className="empty-note">Lade …</p>

  return (
    <div className="admin-section">
      <p className="admin-section-hint">
        Aktiviert/deaktiviert Benachrichtigungstypen und legt fest, wer sie erhalten soll.
        Neue Typen werden vom System nach und nach hinzugefügt.
      </p>

      {categoryOrder.map(cat => (
        <div className="admin-block" key={cat}>
          <h3 className="admin-block-title">{CATEGORY_LABELS[cat] ?? cat}</h3>
          {grouped[cat].sort((a, b) => a.sortOrder - b.sortOrder).map(c => (
            <div key={c.typeKey} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <label style={{
                display: 'flex', alignItems: 'center', cursor: 'pointer',
                paddingTop: 2,
              }} title="Aktiv / inaktiv">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={e => toggleMut.mutate({ typeKey: c.typeKey, enabled: e.target.checked, cur: c })}
                />
              </label>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</div>
                {c.description && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{c.description}</div>
                )}
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  Empfänger: {summarizeAudience(c)}
                </div>
              </div>
              {c.supportsAudienceOverride ? (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setEditingKey(c.typeKey)}
                  disabled={!c.enabled}
                >
                  Bearbeiten
                </button>
              ) : (
                <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', paddingTop: 4 }}>
                  nur ein/aus
                </span>
              )}
            </div>
          ))}
        </div>
      ))}

      <BenachrichtigungEditModal
        open={editingKey != null}
        config={editingKey ? configs.find(c => c.typeKey === editingKey) ?? null : null}
        onClose={() => setEditingKey(null)}
      />

      <LeistungsstandReminderBlock />
      <HoursBookingReminderBlock />
    </div>
  )
}

// ── Reminder-Block: Leistungsstand pflegen ───────────────────────────────────

function LeistungsstandReminderBlock() {
  const TYPE_KEY = 'leistungsstand_reminder'
  const qc = useQueryClient()
  const toast = useToast()
  const [msg, setMsg] = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const [enabled,             setEnabled]             = useState(false)
  const [scheduleDays,        setScheduleDays]        = useState<number[]>([25])
  const [scheduleLastDay,     setScheduleLastDay]     = useState(false)
  const [notifyProjectPm,     setNotifyProjectPm]     = useState(true)
  const [projectStatusIds,    setProjectStatusIds]    = useState<number[]>([])
  const [audienceRoles,       setAudienceRoles]       = useState<string[]>([])
  const [audienceDepartments, setAudienceDepartments] = useState<number[]>([])
  const [audienceEmployees,   setAudienceEmployees]   = useState<number[]>([])
  const [lastFiredDate,       setLastFiredDate]       = useState<string | null>(null)

  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ['notification-schedule', TYPE_KEY],
    queryFn:  () => fetchNotificationSchedule(TYPE_KEY),
  })
  const { data: statusData } = useQuery({ queryKey: ['project-statuses'],     queryFn: fetchProjectStatuses })
  const { data: deptData   } = useQuery({ queryKey: ['departments'],          queryFn: fetchDepartments })
  const { data: empData    } = useQuery({ queryKey: ['active-employees'],     queryFn: fetchActiveEmployees })

  const statuses    = statusData?.data ?? []
  const departments = deptData?.data ?? []
  const employees   = empData?.data ?? []

  useEffect(() => {
    const s = scheduleData?.data
    if (!s) return
    setEnabled(s.ENABLED)
    setScheduleDays(s.SCHEDULE_DAYS ?? [25])
    setScheduleLastDay(s.SCHEDULE_LAST_DAY)
    setNotifyProjectPm(s.NOTIFY_PROJECT_PM)
    setProjectStatusIds(s.PROJECT_STATUS_IDS ?? [])
    setAudienceRoles(s.AUDIENCE_ROLES ?? [])
    setAudienceDepartments(s.AUDIENCE_DEPARTMENTS ?? [])
    setAudienceEmployees(s.AUDIENCE_EMPLOYEES ?? [])
    setLastFiredDate(s.LAST_FIRED_DATE)
  }, [scheduleData?.data])

  const saveMut = useMutation({
    mutationFn: () => upsertNotificationSchedule(TYPE_KEY, {
      enabled, scheduleDays, scheduleLastDay, notifyProjectPm, projectStatusIds,
      audienceRoles, audienceDepartments, audienceEmployees,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-schedule', TYPE_KEY] })
      setMsg({ text: 'Gespeichert.', type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const runMut = useMutation({
    mutationFn: () => runNotificationScheduleNow(TYPE_KEY),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['notification-schedule', TYPE_KEY] })
      toast.success(`Erinnerungen ausgeloest: ${r.created} Notification(s)`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  useCtrlS(() => { setMsg(null); saveMut.mutate() }, !isLoading && !saveMut.isPending)

  // Komma-getrennte Tagesliste fuers Input-Feld
  const [dayInput, setDayInput] = useState('25')
  useEffect(() => {
    setDayInput(scheduleDays.join(', '))
  }, [scheduleDays])

  function commitDays() {
    const parsed = dayInput.split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 31)
    setScheduleDays(Array.from(new Set(parsed)).sort((a, b) => a - b))
  }

  return (
    <div className="admin-block" style={{ marginTop: 24 }}>
      <h3 className="admin-block-title">Reminder & Schedules</h3>
      <p className="admin-section-hint">
        Wiederkehrende Erinnerungen mit eigenem Zeitplan und Empfaengerkonfiguration.
      </p>

      <div style={{
        border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginTop: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong style={{ fontSize: 14 }}>Leistungsstand pflegen</strong>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6b7280' }}>
              Monatliche Erinnerung an die Pflege der Leistungsstaende.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span>aktiv</span>
          </label>
        </div>

        {enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>

            {/* Schedule */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Wann im Monat</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={dayInput}
                  onChange={e => setDayInput(e.target.value)}
                  onBlur={commitDays}
                  placeholder="z.B. 25, 26, 27"
                  style={{ width: 180 }}
                />
                <span style={{ fontSize: 12, color: '#6b7280' }}>(Komma-Liste, Tag 1–31)</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={scheduleLastDay}
                  onChange={e => setScheduleLastDay(e.target.checked)}
                />
                <span>Zusätzlich am letzten Tag des Monats</span>
              </label>
            </div>

            {/* Projekt-Status-Filter */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Projektstatus (welche Projekte berücksichtigt werden)
              </label>
              <select
                multiple
                value={projectStatusIds.map(String)}
                onChange={e => setProjectStatusIds(Array.from(e.target.selectedOptions, o => Number(o.value)))}
                style={{ minHeight: 90, width: '100%' }}
              >
                {statuses.map(s => (
                  <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>
                ))}
              </select>
              <p className="admin-section-hint">
                Leer = alle Projekte. Strg-/Cmd-Klick für Mehrfachauswahl.
              </p>
            </div>

            {/* PM-Empfaenger */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Empfänger
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={notifyProjectPm}
                  onChange={e => setNotifyProjectPm(e.target.checked)}
                />
                <span>
                  <strong>Projektleiter</strong> des jeweiligen Projekts
                  <span style={{ fontSize: 11, color: '#6b7280', display: 'block' }}>
                    Pro Projekt eine Notification an den eingetragenen Projektleiter (Link springt direkt zum Projekt).
                  </span>
                </span>
              </label>
            </div>

            {/* Zusaetzliche Audience */}
            <div style={{ paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
                Zusätzliche Empfänger (OR-verknüpft, Link führt zur Leistungsstand-Liste):
              </p>

              <div className="form-group">
                <label>Rollen</label>
                <select
                  multiple
                  value={audienceRoles}
                  onChange={e => setAudienceRoles(Array.from(e.target.selectedOptions, o => o.value))}
                  style={{ minHeight: 70 }}
                >
                  {Object.entries(DASHBOARD_ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Abteilungen</label>
                <select
                  multiple
                  value={audienceDepartments.map(String)}
                  onChange={e => setAudienceDepartments(Array.from(e.target.selectedOptions, o => Number(o.value)))}
                  style={{ minHeight: 90 }}
                >
                  {departments.map(d => (
                    <option key={d.ID} value={d.ID}>{d.NAME_SHORT}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Plus folgende Mitarbeiter</label>
                <select
                  multiple
                  value={audienceEmployees.map(String)}
                  onChange={e => setAudienceEmployees(Array.from(e.target.selectedOptions, o => Number(o.value)))}
                  style={{ minHeight: 100 }}
                >
                  {employees.map(emp => (
                    <option key={emp.ID} value={emp.ID}>{emp.SHORT_NAME}</option>
                  ))}
                </select>
              </div>
            </div>

            {lastFiredDate && (
              <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                Letzter Lauf: {new Date(lastFiredDate).toLocaleDateString('de-DE')}
              </p>
            )}
          </div>
        )}

        <Message text={msg?.text ?? null} type={msg?.type} />

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn-primary"
            disabled={saveMut.isPending || isLoading}
            onClick={() => { setMsg(null); saveMut.mutate() }}>
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
          <button className="btn-secondary"
            disabled={runMut.isPending || !enabled || !scheduleData?.data}
            onClick={() => runMut.mutate()}
            title="Erinnerung sofort ausloesen, unabhaengig vom Zeitplan">
            {runMut.isPending ? 'Läuft …' : 'Jetzt ausführen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reminder-Block: Stunden fuer heute buchen ────────────────────────────────

function HoursBookingReminderBlock() {
  const TYPE_KEY = 'hours_booking_reminder'
  const qc = useQueryClient()
  const toast = useToast()
  const [msg, setMsg] = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const [enabled,            setEnabled]            = useState(false)
  const [scheduleTimeOfDay,  setScheduleTimeOfDay]  = useState('17:00')
  const [lastFiredDate,      setLastFiredDate]      = useState<string | null>(null)

  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ['notification-schedule', TYPE_KEY],
    queryFn:  () => fetchNotificationSchedule(TYPE_KEY),
  })

  useEffect(() => {
    const s = scheduleData?.data
    if (!s) return
    setEnabled(s.ENABLED)
    // DB liefert "HH:MM:SS" oder NULL — Picker erwartet "HH:MM"
    setScheduleTimeOfDay(s.SCHEDULE_TIME_OF_DAY ? String(s.SCHEDULE_TIME_OF_DAY).slice(0,5) : '17:00')
    setLastFiredDate(s.LAST_FIRED_DATE)
  }, [scheduleData?.data])

  const saveMut = useMutation({
    mutationFn: () => upsertNotificationSchedule(TYPE_KEY, {
      enabled,
      scheduleTimeOfDay,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-schedule', TYPE_KEY] })
      setMsg({ text: 'Gespeichert.', type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const runMut = useMutation({
    mutationFn: () => runNotificationScheduleNow(TYPE_KEY),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['notification-schedule', TYPE_KEY] })
      toast.success(`Erinnerungen ausgeloest: ${r.created} Notification(s)`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  useCtrlS(() => { setMsg(null); saveMut.mutate() }, !isLoading && !saveMut.isPending)

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong style={{ fontSize: 14 }}>Stunden für heute buchen</strong>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6b7280' }}>
            Tägliche Erinnerung an alle aktiven Mitarbeiter, die heute noch keine Zeitbuchung haben.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span>aktiv</span>
        </label>
      </div>

      {enabled && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Uhrzeit (täglich)
            </label>
            <input
              type="time"
              value={scheduleTimeOfDay}
              onChange={e => setScheduleTimeOfDay(e.target.value)}
              style={{ width: 140 }}
            />
            <p className="admin-section-hint">
              Sobald die Uhrzeit erreicht ist, geht eine Notification an alle aktiven
              Mitarbeiter, die heute noch keine TEC-Zeile haben (Mitarbeiter mit
              Buchung werden uebersprungen).
            </p>
          </div>
          {lastFiredDate && (
            <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
              Letzter Lauf: {new Date(lastFiredDate).toLocaleDateString('de-DE')}
            </p>
          )}
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn-primary"
          disabled={saveMut.isPending || isLoading}
          onClick={() => { setMsg(null); saveMut.mutate() }}>
          {saveMut.isPending ? 'Speichert …' : 'Speichern'}
        </button>
        <button className="btn-secondary"
          disabled={runMut.isPending || !enabled || !scheduleData?.data}
          onClick={() => runMut.mutate()}
          title="Erinnerung sofort ausloesen, unabhaengig von der Uhrzeit">
          {runMut.isPending ? 'Läuft …' : 'Jetzt ausführen'}
        </button>
      </div>
    </div>
  )
}

function BenachrichtigungEditModal({ open, config, onClose }: {
  open: boolean
  config: NotificationTypeConfig | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [enabled,             setEnabled]             = useState(true)
  const [audienceUseDefault,  setAudienceUseDefault]  = useState(true)
  const [audienceAllTenant,   setAudienceAllTenant]   = useState(false)
  const [audienceRoles,       setAudienceRoles]       = useState<string[]>([])
  const [audienceDepartments, setAudienceDepartments] = useState<number[]>([])
  const [audienceEmployees,   setAudienceEmployees]   = useState<number[]>([])

  const { data: deptData } = useQuery({ queryKey: ['departments'],       queryFn: fetchDepartments })
  const { data: empData }  = useQuery({ queryKey: ['active-employees'],  queryFn: fetchActiveEmployees })
  const departments = deptData?.data ?? []
  const employees   = empData?.data  ?? []

  useEffect(() => {
    if (!config) return
    setEnabled(config.enabled)
    setAudienceUseDefault(config.audienceUseDefault)
    setAudienceAllTenant(config.audienceAllTenant)
    setAudienceRoles(config.audienceRoles ?? [])
    setAudienceDepartments(config.audienceDepartments ?? [])
    setAudienceEmployees(config.audienceEmployees ?? [])
  }, [config])

  const saveMut = useMutation({
    mutationFn: () => upsertNotificationConfig(config!.typeKey, {
      enabled,
      audienceUseDefault,
      audienceAllTenant,
      audienceRoles,
      audienceDepartments,
      audienceEmployees,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-configs'] })
      onClose()
    },
  })

  if (!config) return null
  const manualMode = !audienceUseDefault

  return (
    <Modal open={open} onClose={onClose} title={config.title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 420 }}>
        {config.description && (
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{config.description}</p>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span>Benachrichtigungstyp aktiv</span>
        </label>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Empfänger</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
            <input
              type="radio"
              name="audMode"
              checked={audienceUseDefault}
              onChange={() => setAudienceUseDefault(true)}
              disabled={!enabled}
            />
            <span>
              <strong>Tenant-Standard</strong>
              <span style={{ fontSize: 11, color: '#6b7280', display: 'block' }}>
                Wirkt für alle Mitarbeiter (tenantweit).
              </span>
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="radio"
              name="audMode"
              checked={!audienceUseDefault}
              onChange={() => setAudienceUseDefault(false)}
              disabled={!enabled}
            />
            <span>
              <strong>Manuell konfigurieren</strong>
              <span style={{ fontSize: 11, color: '#6b7280', display: 'block' }}>
                Empfänger werden aus Rollen / Abteilungen / Mitarbeitern kombiniert (OR-Verknüpfung).
              </span>
            </span>
          </label>
        </div>

        {manualMode && enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 24, borderLeft: '2px solid var(--border)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={audienceAllTenant}
                onChange={e => setAudienceAllTenant(e.target.checked)}
              />
              <span>Alle Mitarbeiter (überspringt die Filter unten)</span>
            </label>

            <div className="form-group" style={{ opacity: audienceAllTenant ? 0.5 : 1 }}>
              <label>Rollen</label>
              <select
                multiple
                disabled={audienceAllTenant}
                value={audienceRoles}
                onChange={e => setAudienceRoles(Array.from(e.target.selectedOptions, o => o.value))}
                style={{ minHeight: 70 }}
              >
                {Object.entries(DASHBOARD_ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <p className="admin-section-hint">Strg-/Cmd-Klick für Mehrfachauswahl.</p>
            </div>

            <div className="form-group" style={{ opacity: audienceAllTenant ? 0.5 : 1 }}>
              <label>Abteilungen</label>
              <select
                multiple
                disabled={audienceAllTenant}
                value={audienceDepartments.map(String)}
                onChange={e => setAudienceDepartments(
                  Array.from(e.target.selectedOptions, o => Number(o.value))
                )}
                style={{ minHeight: 90 }}
              >
                {departments.map(d => (
                  <option key={d.ID} value={d.ID}>{d.NAME_SHORT}</option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ opacity: audienceAllTenant ? 0.5 : 1 }}>
              <label>Plus folgende Mitarbeiter</label>
              <select
                multiple
                disabled={audienceAllTenant}
                value={audienceEmployees.map(String)}
                onChange={e => setAudienceEmployees(
                  Array.from(e.target.selectedOptions, o => Number(o.value))
                )}
                style={{ minHeight: 110 }}
              >
                {employees.map(emp => (
                  <option key={emp.ID} value={emp.ID}>{emp.SHORT_NAME}</option>
                ))}
              </select>
              <p className="admin-section-hint">Zusätzlich zu den Rollen- und Abteilungs-Treffern.</p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'stammdaten'
  const validTabs  = PAGE_TABS.map(t => t.id)
  const [tab, setTab] = useState(validTabs.includes(initialTab) ? initialTab : 'stammdaten')
  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Administration</h1>
      </div>
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />
      <div className="master-section">
        {tab === 'stammdaten'            && <StammdatenSection />}
        {tab === 'nummernkreise'         && <NummernkreiseSection />}
        {tab === 'unternehmen'           && <UnternehmenSection />}
        {tab === 'vorbelegungen'         && <VorbelegungenSection />}
        {tab === 'arbeitszeitmodelle'    && <ArbeitszeitmodelleSection />}
        {tab === 'pausenregeln'          && <PausenregelnSection />}
        {tab === 'arbzg'                 && <ArbzgSettingsSection />}
        {tab === 'monatsabschluss'       && <MonatsabschlussSection />}
        {tab === 'kostensatz'            && <KostensatzSection />}
        {tab === 'mahnungseinstellungen' && <MahnungsEinstellungenSection />}
        {tab === 'textvorlagen'          && <TextVorlagenSection />}
        {tab === 'benachrichtigungen'    && <BenachrichtigungenSection />}
      </div>
    </div>
  )
}
