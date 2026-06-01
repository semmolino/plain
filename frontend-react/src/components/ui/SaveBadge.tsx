import { type SaveState } from '@/hooks/useSaveState'

export function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span className={`save-badge save-badge-${state}`}>
      {state === 'saving' ? '…' : state === 'saved' ? '✓ Gespeichert' : '✕ Fehler'}
    </span>
  )
}
