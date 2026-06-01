import { create } from 'zustand'

export interface Toast {
  id:      string
  message: string
  type:    'success' | 'error' | 'info'
}

interface ToastStore {
  toasts: Toast[]
  add:    (t: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  add(t) {
    const id = `${Date.now()}-${Math.random()}`
    const toasts = get().toasts
    const trimmed = toasts.length >= 3 ? toasts.slice(1) : toasts
    set({ toasts: [...trimmed, { ...t, id }] })
    setTimeout(() => get().remove(id), 3500)
  },
  remove(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  },
}))

export function useToast() {
  const add = useToastStore(s => s.add)
  return {
    success: (message: string) => add({ type: 'success', message }),
    error:   (message: string) => add({ type: 'error',   message }),
    info:    (message: string) => add({ type: 'info',    message }),
  }
}
