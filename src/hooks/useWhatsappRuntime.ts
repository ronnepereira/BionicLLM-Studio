import { useEffect } from 'react'
import { disconnectWhatsapp, whatsappAvailable } from '../api/studio-whatsapp'
import { useWhatsappRuntimeStore } from '../stores/whatsappRuntimeStore'
export function useWhatsappRuntime() {
  useEffect(() => {
    if (!whatsappAvailable()) return
    void useWhatsappRuntimeStore.getState().initialize()
    const stop = () => { void useWhatsappRuntimeStore.getState().stop() }
    const leave = () => { void useWhatsappRuntimeStore.getState().stop().finally(() => { void disconnectWhatsapp().catch(() => {}) }) }
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave); stop() }
  }, [])
}
