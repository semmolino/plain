import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import {
  fetchProjectsShort, fetchProjectStructure, fetchBuchungen, createBuchung, deleteBuchung,
  fetchEmployee2ProjectPreset,
  type Buchung,
} from '@/api/projekte'
import { fetchActiveEmployees } from '@/api/projekte'
import { useAuthStore } from '@/store/authStore'
import { useCtrlS } from '@/hooks/useCtrlS'

const FMT_NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const fmtN    = (v: number | null | undefined) => v == null ? '—' : FMT_NUM.format(v)
const fmtDate = (v: string | null) => v ? v.slice(0, 10) : ''

function todayIso() { return new Date().toISOString().slice(0, 10) }

interface BuchungForm {
  EMPLOYEE_ID:         string
  STRUCTURE_ID:        string
  DATE_VOUCHER:        string
  TIME_START:          string
  TIME_FINISH:         string
  QUANTITY_INT:        string
  CP_RATE:             string
  QUANTITY_EXT:        string
  SP_RATE:             string
  POSTING_DESCRIPTION: string
}

function emptyForm(): BuchungForm {
  return {
    EMPLOYEE_ID: String(useAuthStore.getState().employeeId ?? ''), STRUCTURE_ID: '', DATE_VOUCHER: todayIso(),
    TIME_START: '', TIME_FINISH: '',
    QUANTITY_INT: '', CP_RATE: '', QUANTITY_EXT: '', SP_RATE: '',
    POSTING_DESCRIPTION: '',
  }
}

type SortCol = 'date' | 'employee' | 'path' | 'description' | 'h_int' | 'h_ext' | 'cost' | 'revenue'
type SortDir = 'asc' | 'desc'

interface Props { initialProjectId?: number; onProjectChange?: (id: number | null) => void }

export function Buchungen({ initialProjectId, onProjectChange }: Props = {}) {
  const qc = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [pid,          setPid]          = useState<number | null>(initialProjectId ?? null)
  const [showForm,     setShowForm]     = useState(false)
  const [form,         setForm]         = useState<BuchungForm>(emptyForm)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [filterStruct, setFilterStruct] = useState<string>('')
  const [search,       setSearch]       = useState('')
  const [sortCol,      setSortCol]      = useState<SortCol>('date')
  const [sortDir,      setSortDir]      = useState<SortDir>('asc')

  const { data: projectsData }  = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: empData }       = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: buchData, isLoading } = useQuery({
    queryKey: ['buchungen', pid],
    queryFn:  () => fetchBuchungen(pid!),
    enabled:  pid !== null,
  })
  const { data: structData } = useQuery({
    queryKey: ['structure', pid],
    queryFn:  () => fetchProjectStructure(pid!),
    enabled:  pid !== null,
  })

  const empId = form.EMPLOYEE_ID ? Number(form.EMPLOYEE_ID) : null

  const { data: presetData } = useQuery({
    queryKey: ['e2p-preset', empId, pid],
    queryFn:  () => fetchEmployee2ProjectPreset(empId!, pid!),
    enabled:  empId !== null && pid !== null && showForm,
  })

  const projects  = projectsData?.data ?? []
  const employees = empData?.data      ?? []

  useEffect(() => {
    if (!presetData) return
    setForm(f => ({ ...f, SP_RATE: presetData.found && presetData.SP_RATE != null ? String(presetData.SP_RATE) : f.SP_RATE }))
  }, [presetData])

  useEffect(() => {
    if (!empId) return
    const emp = employees.find(e => e.ID === empId)
    if (emp?.CP_RATE != null) setForm(f => ({ ...f, CP_RATE: String(emp.CP_RATE) }))
  }, [empId, employees])

  // Reset filters when project changes
  useEffect(() => { setFilterStruct(''); setSearch('') }, [pid])

  const buchungen = buchData?.data   ?? []
  const structure = structData?.data ?? []

  const nodeById = useMemo(() => new Map(structure.map(n => [n.STRUCTURE_ID, n])), [structure])
  const parentIds = useMemo(() => new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID))), [structure])

  // childrenMap for descendant lookup
  const childrenMap = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const n of structure) {
      if (n.FATHER_ID != null) {
        const fid = Number(n.FATHER_ID)
        if (!m.has(fid)) m.set(fid, [])
        m.get(fid)!.push(n.STRUCTURE_ID)
      }
    }
    return m
  }, [structure])

  function getDescendantIds(id: number): Set<number> {
    const result = new Set<number>()
    const queue = [id]
    while (queue.length) {
      const cur = queue.shift()!
      result.add(cur)
      for (const child of (childrenMap.get(cur) ?? [])) queue.push(child)
    }
    return result
  }

  // Path builder: ancestors show NAME_SHORT only; leaf shows "NAME_SHORT: NAME_LONG"
  function structPath(id: number): string {
    const cur = nodeById.get(id)
    if (!cur) return ''
    const leaf = cur.NAME_LONG ? `${cur.NAME_SHORT}: ${cur.NAME_LONG}` : cur.NAME_SHORT
    const ancestors: string[] = []
    let fatherId = cur.FATHER_ID ? Number(cur.FATHER_ID) : null
    while (fatherId != null) {
      const parent = nodeById.get(fatherId)
      if (!parent) break
      ancestors.unshift(parent.NAME_SHORT)
      fatherId = parent.FATHER_ID ? Number(parent.FATHER_ID) : null
    }
    return ancestors.length ? `${ancestors.join(' > ')} > ${leaf}` : leaf
  }

  // All structure nodes sorted by path for dropdowns
  const allStructureSorted = useMemo(() =>
    [...structure].sort((a, b) => structPath(a.STRUCTURE_ID).localeCompare(structPath(b.STRUCTURE_ID), 'de', { numeric: true })),
    [structure, nodeById]
  )

  // Leaf-only nodes for the booking form
  const leafStructure = useMemo(() =>
    allStructureSorted.filter(n => !parentIds.has(String(n.STRUCTURE_ID))),
    [allStructureSorted, parentIds]
  )

  // Path cache for display
  const pathCache = useMemo(() => {
    const m = new Map<number, string>()
    for (const n of structure) m.set(n.STRUCTURE_ID, structPath(n.STRUCTURE_ID))
    return m
  }, [structure, nodeById])

  // Descendant set for active filter
  const filterDescendants = useMemo(() => {
    if (!filterStruct) return null
    return getDescendantIds(Number(filterStruct))
  }, [filterStruct, childrenMap])

  // Filtered + sorted buchungen
  const visibleBuchungen = useMemo(() => {
    let rows = buchungen

    if (filterDescendants !== null) {
      rows = rows.filter(b => b.STRUCTURE_ID != null && filterDescendants.has(b.STRUCTURE_ID))
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(b =>
        fmtDate(b.DATE_VOUCHER).includes(q) ||
        (b.EMPLOYEE?.SHORT_NAME ?? '').toLowerCase().includes(q) ||
        (b.POSTING_DESCRIPTION ?? '').toLowerCase().includes(q) ||
        (b.STRUCTURE_ID != null ? (pathCache.get(b.STRUCTURE_ID) ?? '').toLowerCase().includes(q) : false)
      )
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'date':        cmp = (a.DATE_VOUCHER ?? '').localeCompare(b.DATE_VOUCHER ?? ''); break
        case 'employee':    cmp = (a.EMPLOYEE?.SHORT_NAME ?? '').localeCompare(b.EMPLOYEE?.SHORT_NAME ?? '', 'de'); break
        case 'path':        cmp = (a.STRUCTURE_ID != null ? pathCache.get(a.STRUCTURE_ID) ?? '' : '').localeCompare(b.STRUCTURE_ID != null ? pathCache.get(b.STRUCTURE_ID) ?? '' : '', 'de', { numeric: true }); break
        case 'description': cmp = (a.POSTING_DESCRIPTION ?? '').localeCompare(b.POSTING_DESCRIPTION ?? '', 'de'); break
        case 'h_int':       cmp = (a.QUANTITY_INT ?? 0) - (b.QUANTITY_INT ?? 0); break
        case 'h_ext':       cmp = (a.QUANTITY_EXT ?? 0) - (b.QUANTITY_EXT ?? 0); break
        case 'cost':        cmp = (a.CP_TOT ?? 0) - (b.CP_TOT ?? 0); break
        case 'revenue':     cmp = (a.SP_TOT ?? 0) - (b.SP_TOT ?? 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [buchungen, filterDescendants, search, sortCol, sortDir, pathCache])

  const totalIntH = visibleBuchungen.reduce((s, b) => s + (Number(b.QUANTITY_INT) || 0), 0)
  const totalExtH = visibleBuchungen.reduce((s, b) => s + (Number(b.QUANTITY_EXT) || 0), 0)
  const totalCost = visibleBuchungen.reduce((s, b) => s + (Number(b.CP_TOT) || 0), 0)
  const totalRev  = visibleBuchungen.reduce((s, b) => s + (Number(b.SP_TOT) || 0), 0)

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function sortIndicator(col: SortCol) {
    if (sortCol !== col) return <span style={{ opacity: 0.25, marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const createMut = useMutation({
    mutationFn: createBuchung,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
      setMsg({ text: 'Buchung gespeichert ✅', type: 'success' })
      setForm(emptyForm())
      setShowForm(false)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteBuchung,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['buchungen', pid] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  useCtrlS(() => formRef.current?.requestSubmit(), showForm)

  function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!pid || !form.EMPLOYEE_ID || !form.DATE_VOUCHER || !form.QUANTITY_INT || !form.CP_RATE || !form.QUANTITY_EXT || !form.SP_RATE || !form.POSTING_DESCRIPTION) {
      setMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    createMut.mutate({
      PROJECT_ID:          pid,
      STRUCTURE_ID:        form.STRUCTURE_ID  ? Number(form.STRUCTURE_ID) : undefined,
      EMPLOYEE_ID:         Number(form.EMPLOYEE_ID),
      DATE_VOUCHER:        form.DATE_VOUCHER,
      TIME_START:          form.TIME_START  || undefined,
      TIME_FINISH:         form.TIME_FINISH || undefined,
      QUANTITY_INT:        Number(form.QUANTITY_INT),
      CP_RATE:             Number(form.CP_RATE),
      QUANTITY_EXT:        Number(form.QUANTITY_EXT),
      SP_RATE:             Number(form.SP_RATE),
      POSTING_DESCRIPTION: form.POSTING_DESCRIPTION,
    })
  }

  const setF = (k: keyof BuchungForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value
    setForm(f => ({ ...f, [k]: value, ...(k === 'EMPLOYEE_ID' ? { SP_RATE: '', CP_RATE: '' } : {}) }))
  }

  function confirmDelete(b: Buchung) {
    if (!window.confirm(`Buchung vom ${fmtDate(b.DATE_VOUCHER)} löschen?`)) return
    setMsg(null)
    deleteMut.mutate(b.ID)
  }

  return (
    <div>
      <div className="form-group" style={{ maxWidth: 400, marginBottom: 12 }}>
        <label>Projekt</label>
        <select value={pid ?? ''} onChange={e => { const id = e.target.value ? Number(e.target.value) : null; setPid(id); onProjectChange?.(id); setMsg(null); setShowForm(false) }}>
          <option value="">Bitte wählen …</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
        </select>
      </div>

      {pid !== null && (
        <>
          {isLoading && <p className="empty-note">Laden …</p>}
          {!isLoading && (
            <>
              {/* Filters row */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 260px', minWidth: 200, marginBottom: 0 }}>
                  <label>Strukturelement</label>
                  <select value={filterStruct} onChange={e => setFilterStruct(e.target.value)}>
                    <option value="">Alle Strukturelemente</option>
                    {allStructureSorted.map(n => (
                      <option key={n.STRUCTURE_ID} value={n.STRUCTURE_ID}>
                        {pathCache.get(n.STRUCTURE_ID) ?? n.NAME_SHORT}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 220px', minWidth: 180, paddingBottom: 2 }}>
                  <input
                    className="list-search"
                    type="search"
                    placeholder="Suchen …"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div className="list-section">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>Datum{sortIndicator('date')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('employee')}>Mitarbeiter{sortIndicator('employee')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('path')}>Strukturpfad{sortIndicator('path')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('description')}>Beschreibung{sortIndicator('description')}</th>
                      <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('h_int')}>h int.{sortIndicator('h_int')}</th>
                      <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('h_ext')}>h ext.{sortIndicator('h_ext')}</th>
                      <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('cost')}>Kosten €{sortIndicator('cost')}</th>
                      <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('revenue')}>Erlös €{sortIndicator('revenue')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBuchungen.map(b => (
                      <tr key={b.ID}>
                        <td>{fmtDate(b.DATE_VOUCHER)}</td>
                        <td>{b.EMPLOYEE?.SHORT_NAME}</td>
                        <td style={{ fontSize: 13, color: 'rgba(17,24,39,0.6)' }}>
                          {b.STRUCTURE_ID != null ? pathCache.get(b.STRUCTURE_ID) ?? '—' : '—'}
                        </td>
                        <td>{b.POSTING_DESCRIPTION}</td>
                        <td className="num">{fmtN(b.QUANTITY_INT)}</td>
                        <td className="num">{fmtN(b.QUANTITY_EXT)}</td>
                        <td className="num">{fmtN(b.CP_TOT)}</td>
                        <td className="num">{fmtN(b.SP_TOT)}</td>
                        <td><button className="btn-small" onClick={() => confirmDelete(b)}>×</button></td>
                      </tr>
                    ))}
                    {!visibleBuchungen.length && <tr><td colSpan={9} className="empty-note">Keine Buchungen</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                      <td colSpan={3} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                        {visibleBuchungen.length !== buchungen.length
                          ? `${visibleBuchungen.length} / ${buchungen.length} Einträge`
                          : `${buchungen.length} Einträge`}
                      </td>
                      <td></td>
                      <td className="num">{fmtN(totalIntH)}</td>
                      <td className="num">{fmtN(totalExtH)}</td>
                      <td className="num">{fmtN(totalCost)}</td>
                      <td className="num">{fmtN(totalRev)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <button className="btn-small btn-save" style={{ marginTop: 10 }} onClick={() => { setShowForm(!showForm); setMsg(null) }}>
                {showForm ? 'Formular schließen' : '+ Neue Buchung'}
              </button>

              {showForm && (
                <form ref={formRef} onSubmit={submitForm} className="master-form" style={{ marginTop: 12 }}>
                  <div className="form-group">
                    <label>Mitarbeiter*</label>
                    <select value={form.EMPLOYEE_ID} onChange={setF('EMPLOYEE_ID')} required>
                      <option value="">Bitte wählen …</option>
                      {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Strukturelement</label>
                    <select value={form.STRUCTURE_ID} onChange={setF('STRUCTURE_ID')}>
                      <option value="">—</option>
                      {leafStructure.map(s => <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{pathCache.get(s.STRUCTURE_ID) ?? s.NAME_SHORT}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <FormField label="Datum*"      id="bda" type="date"   value={form.DATE_VOUCHER}  onChange={setF('DATE_VOUCHER')} required />
                    <FormField label="Von"         id="bts" type="time"   value={form.TIME_START}    onChange={setF('TIME_START')} />
                    <FormField label="Bis"         id="btf" type="time"   value={form.TIME_FINISH}   onChange={setF('TIME_FINISH')} />
                  </div>
                  <div className="form-row">
                    <FormField label="Stunden int.*" id="bqi" type="number" value={form.QUANTITY_INT}  onChange={setF('QUANTITY_INT')} step="0.25" required />
                    <FormField label="Stunden ext.*" id="bqe" type="number" value={form.QUANTITY_EXT}  onChange={setF('QUANTITY_EXT')} step="0.25" required />
                  </div>
                  <div className="form-row">
                    <FormField label="Kostensatz*"   id="bcr" type="number" value={form.CP_RATE}       onChange={setF('CP_RATE')} step="0.01" required
                      readOnly={employees.find(e => e.ID === empId)?.CP_RATE != null}
                      style={{ background: employees.find(e => e.ID === empId)?.CP_RATE != null ? 'rgba(17,24,39,0.04)' : undefined }} />
                    <FormField label="Stundensatz*"  id="bsr" type="number" value={form.SP_RATE}       onChange={setF('SP_RATE')} step="0.01" required
                      readOnly={presetData?.found === true && presetData.SP_RATE != null}
                      title={presetData?.found === true && presetData.SP_RATE != null ? 'Aus Mitarbeiter/Projekt-Zuordnung vorbelegt' : undefined}
                      style={{ background: presetData?.found === true && presetData.SP_RATE != null ? 'rgba(17,24,39,0.04)' : undefined }} />
                  </div>
                  <div className="form-group">
                    <label>Beschreibung*</label>
                    <textarea rows={2} value={form.POSTING_DESCRIPTION} onChange={setF('POSTING_DESCRIPTION')} required
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15, outline: 'none' }} />
                  </div>
                  <Message text={msg?.text ?? null} type={msg?.type} />
                  <button className="btn-primary" type="submit" disabled={createMut.isPending}>
                    {createMut.isPending ? 'Speichert …' : 'Buchung speichern'}
                  </button>
                </form>
              )}
              {!showForm && <Message text={msg?.text ?? null} type={msg?.type} />}
            </>
          )}
        </>
      )}
    </div>
  )
}
