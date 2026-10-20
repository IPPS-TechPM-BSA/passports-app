import { useState } from 'react'
import type { CSSProperties, Dispatch, DragEvent, SetStateAction } from 'react'

/**
 * Drag-to-reorder for a list of panels, using native HTML5 drag and drop.
 * Spread `handleProps` on the part the user grabs (the panel heading, so text
 * in the body's inputs stays selectable) and `itemProps` on the whole panel.
 */
export function useDragReorder<T>(setItems: Dispatch<SetStateAction<T[]>>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const reset = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleProps = (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
      const panel = e.currentTarget.closest('.panel')
      if (panel) {
        const rect = panel.getBoundingClientRect()
        e.dataTransfer.setDragImage(panel, e.clientX - rect.left, e.clientY - rect.top)
      }
      setDragIndex(index)
    },
    onDragEnd: reset,
  })

  const itemProps = (index: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragIndex === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (overIndex !== index) setOverIndex(index)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (dragIndex === null) return
      e.preventDefault()
      const from = dragIndex
      if (from !== index) {
        setItems(prev => {
          const next = [...prev]
          const [moved] = next.splice(from, 1)
          next.splice(index, 0, moved)
          return next
        })
      }
      reset()
    },
  })

  // Fades the panel being dragged and marks the edge it will land on.
  const itemStyle = (index: number): CSSProperties => {
    if (dragIndex === null) return {}
    if (index === dragIndex) return { opacity: 0.4 }
    if (index !== overIndex) return {}
    return { boxShadow: index < dragIndex ? '0 -3px 0 #00629B' : '0 3px 0 #00629B' }
  }

  return { handleProps, itemProps, itemStyle }
}
