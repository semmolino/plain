import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { useConfirm } from '@/hooks/useConfirm'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useToast } from '@/store/toastStore'
import { fetchAllEntitlements, putEntitlementsBulk } from '@/api/abwesenheit'
import type { Employee } from '@/api/mitarbeiter'

// ── Urlaubsansprüche (Bulk-Editor je Jahr) ────────────────────────────────────
// Runde 10: Eingaben liegen über dem geladenen Stand. Vorher setzte jedes
// Nachladen der Mitarbeiterliste (Fensterwechsel genügte) alle Felder
// zurück, ein leeres Feld ging als 0 Tage an den Server — für jeden
// Mitarbeiter ohne Eintrag entstand so ein Anspruch von 0 —, und „27,5"
// ließ das Zahlenfeld gar nicht erst zu.
const parseDays = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const daysText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export function UrlaubsanspruecheEditor({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [year, setYear] = useState(new Date().getFullYear())
  const [edits, setEdits] = useState<Record<number, { days?: string; carry?: string }>>({})
  const [bulkVal, setBulkVal] = useState('')
  const [tried, setTried] = useState(false)

  const { data: entRes, isLoading } = useQuery({ queryKey: ['entitlements-all', year], queryFn: () => fetchAllEntitlements(year) })

  const active = useMemo(
    () => employees.filter(e => e.ACTIVE !== 2).sort((a, b) => (a.ABBR || '').localeCompare(b.ABBR || '')),
    [employees])
  const saved = useMemo(() => {
    const byEmp = new Map((entRes?.data ?? []).map(e => [e.EMPLOYEE_ID, e]))
    const out: Record<number, { days: string; carry: string }> = {}
    for (const e of active) {
      const ent = byEmp.get(e.ID)
      out[e.ID] = { days: daysText(ent?.DAYS_ENTITLED), carry: daysText(ent?.CARRYOVER_OVERRIDE) }
    }
    return out
  }, [entRes, active])
  const val = (id: number) => ({ ...saved[id], ...edits[id] })
  const changedIds = active.map(e => e.ID).filter(id => {
    const v = val(id)
    return v.days !== saved[id]?.days || v.carry !== saved[id]?.carry
  })
  const invalidIds = changedIds.filter(id => {
    const d = parseDays(val(id).days), c = parseDays(val(id).carry)
    return d == null || Number.isNaN(d) || d < 0 || d > 366 || Number.isNaN(c as number)
  })
  const dirty = changedIds.length > 0

  const saveMut = useMutation({
    mutationFn: () => putEntitlementsBulk(year, changedIds.map(id => ({
      employee_id: id,
      days_entitled: parseDays(val(id).days) ?? 0,
      carryover_override: parseDays(val(id).carry),
    }))),
    onSuccess: (r) => {
      toast.success(`${r.count} ${r.count === 1 ? 'Urlaubsanspruch' : 'Urlaubsansprüche'} gespeichert`)
      setEdits({}); setTried(false)
      void qc.invalidateQueries({ queryKey: ['entitlements-all'] })
      void qc.invalidateQueries({ queryKey: ['entitlements'] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance'] })
      void qc.invalidateQueries({ queryKey: ['my-vacation-balance'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Runde 11: der Wechsel des Unterreiters warf offene Eingaben ohne Rückfrage weg.
  useRegisterDirty('urlaubsansprueche', {
    dirty, label: `Urlaubsansprüche ${year}`, count: changedIds.length,
    save: async () => {
      if (invalidIds.length) throw new Error('Bitte bei den markierten Mitarbeitern einen Anspruch zwischen 0 und 366 Tagen angeben.')
      await saveMut.mutateAsync()
    },
  })

  function save() {
    setTried(true)
    if (invalidIds.length) {
      toast.error('Bitte bei den markierten Mitarbeitern einen Anspruch zwischen 0 und 366 Tagen angeben.')
      return
    }
    saveMut.mutate()
  }

  async function changeYear(delta: number) {
    if (dirty && !(await confirm({
      title: 'Änderungen verwerfen?',
      message: `Die Ansprüche für ${year} sind noch nicht gespeichert (${changedIds.length} ${changedIds.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'}).`,
      confirmLabel: 'Verwerfen',
    }))) return
    setEdits({}); setTried(false); setYear(y => y + delta)
  }

  function applyBulk() {
    const v = bulkVal.trim()
    if (v === '') return
    setEdits(prev => { const n = { ...prev }; for (const e of active) n[e.ID] = { ...n[e.ID], days: v }; return n })
  }
  const setField = (id: number, k: 'days' | 'carry', v: string) => setEdits(p => ({ ...p, [id]: { ...p[id], [k]: v } }))

  return (
    <div className="ent-editor">
      <div className="ent-toolbar">
        <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={() => void changeYear(-1)} aria-label="Vorjahr">
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="ent-year" aria-live="polite">{year}</span>
        <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={() => void changeYear(1)} aria-label="Folgejahr">
          <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="ent-bulk">
          <label className="sr-only" htmlFor="ent-bulk">Tage für alle</label>
          <input id="ent-bulk" type="text" inputMode="decimal" className="tbl-input ent-input"
            placeholder="Tage" value={bulkVal} onChange={e => setBulkVal(e.target.value)} />
          <button type="button" className="btn-secondary btn-small" onClick={applyBulk} disabled={!bulkVal.trim()}>Allen zuweisen</button>
        </span>
      </div>
      <p className="ent-hint">
        Jahres-Urlaubsanspruch je Mitarbeiter für {year}. „Übertrag manuell" überschreibt den automatischen
        Übertrag aus dem Vorjahr (leer = automatisch). Gespeichert werden nur geänderte Zeilen.
      </p>

      {isLoading && <ListLoading columns={3} />}
      {!isLoading && active.length === 0 && (
        <p className="empty-note">Keine aktiven Mitarbeiter. (Der Editor benötigt das Recht „Mitarbeiter ansehen".)</p>
      )}

      {!isLoading && active.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="master-table">
              <thead><tr>
                <th scope="col">Mitarbeiter</th>
                <th scope="col" className="num">Anspruch (Tage)</th>
                <th scope="col" className="num">Übertrag manuell</th>
              </tr></thead>
              <tbody>
                {active.map(e => {
                  const v = val(e.ID)
                  const bad = tried && invalidIds.includes(e.ID)
                  return (
                    <tr key={e.ID}>
                      <td><strong>{e.ABBR}</strong> {e.FIRST_NAME} {e.LAST_NAME}</td>
                      <td className="num">
                        <input type="text" inputMode="decimal" className="tbl-input ent-input" aria-label={`Anspruch ${e.ABBR}`}
                          placeholder="—" aria-invalid={bad || undefined}
                          value={v.days} onChange={ev => setField(e.ID, 'days', ev.target.value)} />
                      </td>
                      <td className="num">
                        <input type="text" inputMode="decimal" className="tbl-input ent-input" aria-label={`Übertrag ${e.ABBR}`}
                          placeholder="auto" value={v.carry} onChange={ev => setField(e.ID, 'carry', ev.target.value)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="ent-actions">
            {dirty && <span className="ent-status">{changedIds.length} {changedIds.length === 1 ? 'Zeile' : 'Zeilen'} geändert</span>}
            {dirty && <button type="button" className="btn-secondary btn-small" onClick={() => { setEdits({}); setTried(false) }} disabled={saveMut.isPending}>Verwerfen</button>}
            <button type="button" className="btn-primary btn-small" disabled={saveMut.isPending || !dirty} onClick={save}>
              {saveMut.isPending ? 'Speichert …' : `Ansprüche ${year} speichern`}
            </button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  )
}
