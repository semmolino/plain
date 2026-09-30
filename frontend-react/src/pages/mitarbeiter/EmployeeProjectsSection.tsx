import { useQuery } from '@tanstack/react-query'
import { fetchEmployeeProjects, type EmployeeProject } from '@/api/mitarbeiter'

// ── Projekte-Sektion (innerhalb der Mitarbeiter-Akte) ────────────────────────

export function EmployeeProjectsSection({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['emp-projects', employeeId],
    queryFn:  () => fetchEmployeeProjects(employeeId),
  })
  const rows: EmployeeProject[] = data?.data ?? []

  if (isLoading) return <p className="empty-note">Laden …</p>
  if (!rows.length) return <p className="empty-note">Dieser Mitarbeiter ist keinem Projekt zugeordnet.</p>

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 12 }}>
          <th scope="col" style={{ textAlign: 'left',  padding: '3px 8px 4px 0' }}>Projekt</th>
          <th scope="col" style={{ textAlign: 'left',  padding: '3px 8px 4px 0' }}>Status</th>
          <th scope="col" style={{ textAlign: 'left',  padding: '3px 8px 4px 0' }}>Rolle</th>
          <th scope="col" style={{ textAlign: 'right', padding: '3px 0 4px 8px' }}>Stundensatz</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.ID} style={{ borderBottom: '1px solid var(--border-3)' }}>
            <td style={{ padding: '4px 8px 4px 0' }}>
              <strong>{r.PROJECT_NUMBER || '—'}</strong>
              {r.PROJECT_NAME ? <span style={{ color: 'var(--text-3)' }}> · {r.PROJECT_NAME}</span> : null}
            </td>
            <td style={{ padding: '4px 8px 4px 0' }}>{r.STATUS_NAME || '—'}</td>
            <td style={{ padding: '4px 8px 4px 0' }}>{r.ROLE_ABBR || '—'}</td>
            <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {r.HOURLY_RATE != null ? `${Number(r.HOURLY_RATE).toFixed(2)} €/h` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
