import { type CSSProperties } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HelpHint } from '@/components/ui/HelpHint'
import {
  fetchTextSnippets, createTextSnippet, deleteTextSnippet, type TextSnippet,
} from '@/api/textSnippets'

const insertBtn: CSSProperties = {
  background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0,
  fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/**
 * Textbaustein-Leiste für Buchungs-Beschreibungen.
 * Zeigt globale (admin) + eigene persönliche Bausteine; Klick fügt den Text an,
 * „＋ Als Baustein speichern" legt einen persönlichen an, × löscht persönliche.
 */
export function TextSnippetBar({ currentText, onChange }: { currentText: string; onChange: (text: string) => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['text-snippets'], queryFn: fetchTextSnippets })
  const snippets: TextSnippet[] = data?.data ?? []

  const createMut = useMutation({
    mutationFn: createTextSnippet,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['text-snippets'] }),
  })
  const delMut = useMutation({
    mutationFn: deleteTextSnippet,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['text-snippets'] }),
  })

  function insert(s: TextSnippet) {
    onChange(currentText.trim() ? `${currentText} ${s.TEXT}` : s.TEXT)
  }

  const global   = snippets.filter(s => s.SCOPE === 'global')
  const personal = snippets.filter(s => s.SCOPE === 'employee')

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      <span style={{ fontSize: 11, color: 'rgba(17,24,39,0.5)', display: 'inline-flex', alignItems: 'center' }}>
        Textbausteine <HelpHint id="bookings.text_snippets" />
      </span>

      {global.map(s => (
        <button key={`g${s.ID}`} type="button" title={s.TEXT} onClick={() => insert(s)}
          style={{ ...insertBtn, background: 'rgba(17,24,39,0.06)', color: '#374151', borderRadius: 999, padding: '3px 10px' }}>
          {s.LABEL || s.TEXT}
        </button>
      ))}

      {personal.map(s => (
        <span key={`p${s.ID}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(99,102,241,0.10)', color: '#3730a3', borderRadius: 999, padding: '2px 4px 2px 10px', fontSize: 12 }}>
          <button type="button" title={s.TEXT} onClick={() => insert(s)} style={insertBtn}>{s.LABEL || s.TEXT}</button>
          <button type="button" title="Baustein löschen" onClick={() => delMut.mutate(s.ID)}
            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: '0 4px', fontSize: 13, lineHeight: 1 }}>×</button>
        </span>
      ))}

      <button type="button"
        disabled={!currentText.trim() || createMut.isPending}
        onClick={() => createMut.mutate({ text: currentText.trim() })}
        className="btn-small" style={{ fontSize: 12, padding: '2px 8px' }}>
        ＋ Als Baustein speichern
      </button>
    </div>
  )
}
