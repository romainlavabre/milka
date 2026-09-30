// Palette of collection colors.
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { COLLECTION_COLORS } from '@core/model'

export function ColorPalette({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5 p-1">
      {COLLECTION_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          className={clsx(
            'flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-panel-2',
            value === color && 'ring-2 ring-fg'
          )}
          style={{ background: color }}
          onClick={() => onChange(color)}
        >
          {value === color && <Check className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  )
}
