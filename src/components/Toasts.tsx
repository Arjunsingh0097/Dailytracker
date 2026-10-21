import { useToasts } from '../hooks/useToasts'

export function Toasts() {
  const { toasts, dismissToast } = useToasts()

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.onClick()
                dismissToast(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
