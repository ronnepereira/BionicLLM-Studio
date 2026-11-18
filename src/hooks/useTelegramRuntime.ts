import { useEffect } from 'react'
import { telegramAvailable } from '../api/studio-telegram'
import { useTelegramRuntimeStore } from '../stores/telegramRuntimeStore'

export function useTelegramRuntime() {
  useEffect(() => {
    if (!telegramAvailable()) return
    void useTelegramRuntimeStore.getState().initialize()
    const stop = () => { void useTelegramRuntimeStore.getState().stop() }
    window.addEventListener('pagehide', stop)
    return () => { window.removeEventListener('pagehide', stop); stop() }
  }, [])
}
