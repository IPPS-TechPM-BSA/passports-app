interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel, danger = false, busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, zIndex: 1050,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        className="panel panel-default"
        style={{
          maxWidth: 440, width: '100%', margin: 0,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)', background: '#fff',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="panel-title" style={{ margin: 0 }}>{title}</h3>
          <button
            type="button"
            className="close"
            aria-label={cancelLabel}
            onClick={onCancel}
            style={{ color: '#333', opacity: 0.6, fontSize: '1.4rem', lineHeight: 1 }}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div className="panel-body" style={{ fontSize: '0.95rem' }}>
          <p style={{ marginTop: 0 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-default" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
