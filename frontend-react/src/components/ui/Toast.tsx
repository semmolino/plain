import { useToastStore } from '@/store/toastStore'

export function ToastContainer() {
  const { toasts, remove } = useToastStore()
  if (!toasts.length) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="alert">
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => remove(t.id)} aria-label="Schließen">✕</button>
        </div>
      ))}
    </div>
  )
}
