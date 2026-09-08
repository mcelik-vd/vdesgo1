import { useEffect } from 'react'
import { useWindowStore } from '../stores/useWindowStore'

export function useUnsavedWorkGuard() {
  const hasDirtyWindow = useWindowStore((state) => state.windows.some((window) => window.isDirty))

  useEffect(() => {
    if (!hasDirtyWindow) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasDirtyWindow])
}