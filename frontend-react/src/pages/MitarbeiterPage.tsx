import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }      from '@/components/ui/Tabs'
import { Modal }     from '@/components/ui/Modal'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import {
  fetchEmployeeList, fetchEmployeeGenders, createEmployee, updateEmployee,
  type Employee, type CreateEmployeePayload, type UpdateEmployeePayload,
} from '@/api/mitarbeiter'

const PAGE_SIZE = 25

const TABS = [
  { id: 'list',   label: 'Mitarbeiterliste' },
  { id: 'create', label: 'Anlegen' },
]

type SortKey = 'SHORT_NAME' | 'FIRST_NAME' | 'LAST_NAME' | 'MAIL'

function emptyForm(): CreateEmployeePayload {
  return { short_name: '', title: '', first_name: '', last_name: '', password: '', email: '', mobile: '', personnel_number: '', gender_id: '' }
}

// ── Employee list ─────────────────────────────────────────────────────────────

function SortTh({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: SortKey; current: SortKey; dir: 'asc' | 'desc'; onClick: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th className="sortable-th" onClick={() => onClick(sortKey)}>
      {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MitarbeiterPage() {
  const qc = useQueryClient()
  const [tab,      setTab]      = useState('list')
  const [search,   setSearch]   = useState('')
  const [sortKey,  setSortKey]  = useState<SortKey>('SHORT_NAME')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('asc')
  const [page,     setPage]     = useState(1)
  const [editRow,  setEditRow]  = useState<Employee | null>(null)
  const [form,     setForm]     = useState<CreateEmployeePayload>(emptyForm)
  const [editForm, setEditForm] = useState<UpdateEmployeePayload>({
    short_name: '', title: '', first_name: '', last_name: '', mail: '', mobile: '', personnel_number: '', gender_id: 0,
  })
  const [createMsg, setCreateMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editMsg,   setEditMsg]   = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: listData, isLoading } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployeeList })
  const { data: genData }             = useQuery({ queryKey: ['emp-genders'], queryFn: fetchEmployeeGenders })

  const employees = listData?.data ?? []
  const genders   = genData?.data  ?? []

  // Filter + sort + paginate
  const processed = useMemo(() => {
    let rows = employees
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        [r.SHORT_NAME, r.FIRST_NAME, r.LAST_NAME, r.MAIL, r.MOBILE, r.PERSONNEL_NUMBER, r.GENDER]
          .map(v => String(v ?? '')).join(' ').toLowerCase().includes(q)
      )
    }
    rows = [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      return sortDir === 'asc'
        ? av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
        : bv.localeCompare(av, 'de', { sensitivity: 'base', numeric: true })
    })
    return rows
  }, [employees, search, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = processed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1)
  }

  // Mutations
  const createMut = useMutation({
    mutationFn: createEmployee,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setCreateMsg({ text: 'Mitarbeiter gespeichert ✅', type: 'success' })
      setForm(emptyForm())
    },
    onError: (e: Error) => setCreateMsg({ text: e.message, type: 'error' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateEmployeePayload }) => updateEmployee(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => setEditRow(null), 800)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  function openEdit(row: Employee) {
    setEditForm({
      short_name:       row.SHORT_NAME ?? '',
      title:            row.TITLE ?? '',
      first_name:       row.FIRST_NAME ?? '',
      last_name:        row.LAST_NAME ?? '',
      mail:             row.MAIL ?? '',
      mobile:           row.MOBILE ?? '',
      personnel_number: row.PERSONNEL_NUMBER ?? '',
      gender_id:        row.GENDER_ID ?? 0,
    })
    setEditMsg(null)
    setEditRow(row)
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateMsg(null)
    if (!form.short_name || !form.first_name || !form.last_name || !form.gender_id) {
      setCreateMsg({ text: 'Kürzel, Vorname, Nachname und Geschlecht sind Pflichtfelder', type: 'error' }); return
    }
    createMut.mutate(form)
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRow) return
    setEditMsg(null)
    if (!editForm.short_name || !editForm.first_name || !editForm.last_name || !editForm.gender_id) {
      setEditMsg({ text: 'Pflichtfelder ausfüllen', type: 'error' }); return
    }
    updateMut.mutate({ id: editRow.ID, body: editForm })
  }

  const setF = (k: keyof CreateEmployeePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const setE = (k: keyof UpdateEmployeePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm(f => ({ ...f, [k]: k === 'gender_id' ? Number(e.target.value) : e.target.value }))

  const sortProps = { current: sortKey, dir: sortDir, onClick: toggleSort }

  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Mitarbeiter</h1>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={t => { setTab(t); setCreateMsg(null) }} />

      <div className="master-section">
        {tab === 'list' && (
          <>
            <div className="list-toolbar">
              <input
                className="list-search"
                placeholder="Suchen …"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
              />
              <span className="list-info">
                {processed.length} Mitarbeiter · Seite {safePage}/{totalPages}
              </span>
            </div>

            {isLoading && <p className="empty-note">Laden …</p>}
            {!isLoading && (
              <>
                <table className="master-table">
                  <thead>
                    <tr>
                      <SortTh label="Kürzel"   sortKey="SHORT_NAME" {...sortProps} />
                      <SortTh label="Vorname"  sortKey="FIRST_NAME" {...sortProps} />
                      <SortTh label="Nachname" sortKey="LAST_NAME"  {...sortProps} />
                      <SortTh label="E-Mail"   sortKey="MAIL"       {...sortProps} />
                      <th>Mobil</th>
                      <th>Personalnr.</th>
                      <th>Geschlecht</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(r => (
                      <tr key={r.ID}>
                        <td>{r.SHORT_NAME}</td>
                        <td>{r.FIRST_NAME}</td>
                        <td>{r.LAST_NAME}</td>
                        <td>{r.MAIL}</td>
                        <td>{r.MOBILE}</td>
                        <td>{r.PERSONNEL_NUMBER}</td>
                        <td>{r.GENDER}</td>
                        <td><button className="btn-small" onClick={() => openEdit(r)}>Bearbeiten</button></td>
                      </tr>
                    ))}
                    {!pageRows.length && <tr><td colSpan={8} className="empty-note">Keine Einträge</td></tr>}
                  </tbody>
                </table>
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Zurück</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Weiter →</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'create' && (
          <form onSubmit={submitCreate} className="master-form">
            <FormField label="Kürzel*"        id="mku" value={form.short_name} onChange={setF('short_name')} required />
            <FormField label="Titel"          id="mti" value={form.title ?? ''} onChange={setF('title')} />
            <div className="form-row">
              <FormField label="Vorname*"     id="mfn" value={form.first_name} onChange={setF('first_name')} required />
              <FormField label="Nachname*"    id="mln" value={form.last_name} onChange={setF('last_name')} required />
            </div>
            <FormField label="E-Mail"         id="mem" value={form.email ?? ''} onChange={setF('email')} type="email" />
            <FormField label="Mobil"          id="mmo" value={form.mobile ?? ''} onChange={setF('mobile')} />
            <FormField label="Personalnr."    id="mpn" value={form.personnel_number ?? ''} onChange={setF('personnel_number')} />
            <FormField label="Passwort"       id="mpw" value={form.password ?? ''} onChange={setF('password')} type="password" />
            <div className="form-group">
              <label htmlFor="mge">Geschlecht*</label>
              <select id="mge" value={String(form.gender_id)} onChange={setF('gender_id')} required>
                <option value="">Bitte wählen …</option>
                {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
              </select>
            </div>
            <Message text={createMsg?.text ?? null} type={createMsg?.type} />
            <button className="btn-primary" type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
          </form>
        )}
      </div>

      {/* Edit modal */}
      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title="Mitarbeiter bearbeiten">
        <form onSubmit={submitEdit} className="master-form">
          <FormField label="Kürzel*"      id="eku" value={editForm.short_name} onChange={setE('short_name')} required />
          <FormField label="Titel"        id="eti" value={editForm.title ?? ''} onChange={setE('title')} />
          <div className="form-row">
            <FormField label="Vorname*"   id="efn" value={editForm.first_name} onChange={setE('first_name')} required />
            <FormField label="Nachname*"  id="eln" value={editForm.last_name} onChange={setE('last_name')} required />
          </div>
          <FormField label="E-Mail"       id="eem" value={editForm.mail ?? ''} onChange={setE('mail')} type="email" />
          <FormField label="Mobil"        id="emo" value={editForm.mobile ?? ''} onChange={setE('mobile')} />
          <FormField label="Personalnr."  id="epn" value={editForm.personnel_number ?? ''} onChange={setE('personnel_number')} />
          <div className="form-group">
            <label htmlFor="ege">Geschlecht*</label>
            <select id="ege" value={String(editForm.gender_id)} onChange={setE('gender_id')} required>
              <option value="">Bitte wählen …</option>
              {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
            </select>
          </div>
          <Message text={editMsg?.text ?? null} type={editMsg?.type} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setEditRow(null)}>Abbrechen</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
