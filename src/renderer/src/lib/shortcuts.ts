// App shortcuts. Listened in the capture phase, so they also work while
// typing in an editor (Monaco would otherwise take Ctrl+Enter for itself).
import { useEffect, useRef } from 'react'

export function useShortcut(key: string, handler: () => void, enabled = true): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault()
        e.stopPropagation()
        ref.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [key, enabled])
}
