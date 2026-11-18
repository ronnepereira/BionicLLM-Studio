import { useEffect } from 'react'
import { metaAvailable } from '../api/studio-whatsapp-meta'
import { useMetaRuntimeStore } from '../stores/metaRuntimeStore'
export function useMetaRuntime() {
  useEffect(() => {
    if (!metaAvailable()) return
    void useMetaRuntimeStore.getState().initialize()
    const stop = () => { void useMetaRuntimeStore.getState().stop() }
    window.addEventListener('pagehide', stop)
    return () => { window.removeEventListener('pagehide', stop); stop() }
  }, [])
}
