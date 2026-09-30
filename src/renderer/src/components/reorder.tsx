// Reordering of table rows by drag and drop, from a grip at the start of each row.
import { GripVertical } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'

/** Moves the item at `from` so that it lands before the item at `to` (`items.length`: at the end). */
function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to > from ? to - 1 : to, 0, item)
  return next
}

const DRAG_TYPE = 'application/x-milka-row'

export interface RowReorder {
  /** The grip, in the first cell of the row. */
  handle: (index: number) => ReactNode
  /** Drop target props of the row, with the line showing where it lands. */
  rowProps: (index: number) => {
    onDragOver: (e: DragEvent<HTMLTableRowElement>) => void
    onDrop: (e: DragEvent<HTMLTableRowElement>) => void
    style: { boxShadow?: string }
  }
}

/** Index the dragged row is inserted at when dropped on `row`: before it on its upper half, else after it. */
function insertionIndex(e: DragEvent<HTMLTableRowElement>, row: number): number {
  const box = e.currentTarget.getBoundingClientRect()
  return e.clientY < box.top + box.height / 2 ? row : row + 1
}

export function useRowReorder<T>(items: T[], onChange: (items: T[]) => void): RowReorder {
  // A ref, not state: dragover and drop can fire before React renders a state update.
  const dragged = useRef<number | null>(null)
  // Only draws the drop line.
  const [target, setTarget] = useState<number | null>(null)
  const reset = (): void => {
    dragged.current = null
    setTarget(null)
  }

  return {
    handle: (index) => (
      <span
        draggable
        role="button"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="flex h-7 cursor-grab items-center justify-center text-muted opacity-0 group-hover:opacity-100 active:cursor-grabbing"
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, String(index))
          e.dataTransfer.effectAllowed = 'move'
          const row = e.currentTarget.closest('tr')
          if (row) e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2)
          dragged.current = index
        }}
        onDragEnd={reset}
      >
        <GripVertical className="size-3.5" />
      </span>
    ),
    rowProps: (index) => ({
      onDragOver(e) {
        // Rows of another table are not ours to move.
        if (dragged.current === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setTarget(insertionIndex(e, index))
      },
      onDrop(e) {
        const from = dragged.current
        if (from === null) return
        e.preventDefault()
        const to = insertionIndex(e, index)
        if (to !== from && to !== from + 1) onChange(moveItem(items, from, to))
        reset()
      },
      style: {
        boxShadow:
          target === index
            ? 'inset 0 2px 0 var(--accent)'
            : target === index + 1 && index === items.length - 1
              ? 'inset 0 -2px 0 var(--accent)'
              : undefined
      }
    })
  }
}
