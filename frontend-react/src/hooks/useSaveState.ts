import { useState, useRef, useEffect } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useSaveState() {
  const [state, setState] = useState<SaveState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  function mark(s: SaveState) {
    setState(s)
    if (s === 'saved' || s === 'error') {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setState('idle'), 2000)
    }
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { state, mark }
}
