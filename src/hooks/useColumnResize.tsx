import { useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

// A column with no width is flexible: it shares whatever room the fixed
// columns leave, and only becomes fixed once someone drags its edge.
export type ColumnWidths = Record<string, number | undefined>

const MIN_COLUMN_WIDTH = 50

function loadWidths(storageKey: string, defaults: ColumnWidths): ColumnWidths {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return { ...defaults, ...JSON.parse(saved) }
  } catch { /* ignore */ }
  return defaults
}

/**
 * Drag-to-resize table columns, remembered per browser under `storageKey`.
 * Put `resizeHandle(key, tooltip)` inside each `<th>` (which must be
 * `position: relative`) and apply `widths[key]` as that column's width.
 */
export function useColumnResize(storageKey: string, defaults: ColumnWidths) {
  const [widths, setWidths] = useState<ColumnWidths>(() => loadWidths(storageKey, defaults))
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const startResize = (key: string, e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widths[key] ?? (e.currentTarget.parentElement as HTMLElement).offsetWidth
    let width = startWidth
    setActiveKey(key)

    const onMove = (ev: MouseEvent) => {
      width = Math.max(MIN_COLUMN_WIDTH, startWidth + (ev.clientX - startX))
      setWidths(prev => ({ ...prev, [key]: width }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setActiveKey(null)
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...widths, [key]: width }))
      } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // A faint divider at rest that turns into a full-height blue bar on hover
  // and while dragging. The grab area is wider than the line so it is easy
  // to hit.
  const resizeHandle = (key: string, tooltip: string) => {
    const lit = hoverKey === key || activeKey === key
    return (
      <span
        role="separator"
        aria-orientation="vertical"
        title={tooltip}
        onMouseDown={e => startResize(key, e)}
        onMouseEnter={() => setHoverKey(key)}
        onMouseLeave={() => setHoverKey(null)}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 11,
          display: 'flex', justifyContent: 'center',
          cursor: 'col-resize', userSelect: 'none',
        }}
      >
        <span style={{
          width: lit ? 3 : 1,
          margin: lit ? 0 : '8px 0',
          borderRadius: 2,
          background: lit ? '#00629B' : '#c8ced6',
          transition: 'background 0.15s, width 0.15s, margin 0.15s',
        }} />
      </span>
    )
  }

  return { widths, resizeHandle }
}
