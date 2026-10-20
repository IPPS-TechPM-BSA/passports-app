interface DeletePopupProps {
  label: string
  onClick: () => void
}

/**
 * Small popup shown beside a checked row's checkbox. The parent cell must be
 * `position: relative`.
 */
export default function DeletePopup({ label, onClick }: DeletePopupProps) {
  return (
    <div style={{
      position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', zIndex: 10,
      background: '#fff', border: '1px solid #ccc', borderRadius: 4, padding: 4,
      boxShadow: '0 2px 8px rgba(0,0,0,.2)', whiteSpace: 'nowrap',
    }}>
      <button className="btn" style={{
        fontSize: '0.75rem', padding: '.3em .6em', lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 0, margin: 0, fontWeight: 700, textTransform: 'none', letterSpacing: 'normal',
        border: 'none', borderRadius: '.25em', background: 'transparent', color: '#a94442',
      }} onClick={onClick}>
        <span className="glyphicon glyphicon-trash" style={{ marginRight: 4 }}></span>
        {label}
      </button>
    </div>
  )
}
