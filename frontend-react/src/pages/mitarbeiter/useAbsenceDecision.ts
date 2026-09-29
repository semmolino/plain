import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/store/toastStore'
import { decideAbsence, type Absence } from '@/api/abwesenheit'
import { fmtAbsenceRange } from './absenceFormat'

/** Genehmigen/Ablehnen samt Nachladen aller Abwesenheits-Ansichten (Runde 11). */
const INVALIDATE = ['absences-inbox', 'absences-calendar', 'absences-overlap', 'absences', 'vacation-balance', 'my-absences', 'my-vacation-balance']

export function useAbsenceDecision() {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => { for (const k of INVALIDATE) void qc.invalidateQueries({ queryKey: [k] }) }
  const decide = useMutation({
    mutationFn: (v: { a: Absence; decision: 'APPROVED' | 'REJECTED'; note?: string }) => decideAbsence(v.a.ID, v.decision, v.note),
    onSuccess: (_r, v) => {
      toast.success(`${v.a.EMPLOYEE_SHORT_NAME ?? 'Antrag'}: ${fmtAbsenceRange(v.a)} ${v.decision === 'APPROVED' ? 'genehmigt' : 'abgelehnt'}.`)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return { decide, refresh }
}
