import { useEffect } from 'react'
import { SCHEDULE_KEY, useScheduleStore } from '../stores/scheduleStore'
import { tickSchedules } from '../lib/schedule-runtime'
import { runScheduledAgent } from '../api/agents/scheduled-agent'
import { useChatStore } from '../stores/chatStore'
import { useModelStore } from '../stores/modelStore'

export function useScheduleRuntime() {
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const tick = async () => {
      if (pending || controller.signal.aborted || !useChatStore.persist.hasHydrated() || !useModelStore.getState().inventoryLoaded) return
      pending = true
      try { await tickSchedules(runScheduledAgent, controller.signal, Date.now(), () => useChatStore.getState().activeConversationId) }
      catch (error) { useScheduleStore.setState({ error: error instanceof Error ? error.message : String(error) }) }
      finally { pending = false }
    }
    const refresh = () => useScheduleStore.getState().refresh()
    const changed = (event: StorageEvent) => { if (event.key === SCHEDULE_KEY || event.key === null) refresh() }
    refresh()
    if (!navigator.locks) useScheduleStore.setState({ error: 'O agendador precisa de um navegador ou WebView2 com bloqueio de tarefas disponível.' })
    const timer = window.setInterval(() => { void tick() }, 10_000)
    const unsubscribe = useScheduleStore.subscribe((state, previous) => {
      if (state.items !== previous.items) void tick()
    })
    window.addEventListener('storage', changed)
    window.addEventListener('focus', refresh)
    void tick()
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('storage', changed)
      window.removeEventListener('focus', refresh)
      unsubscribe()
    }
  }, [])
}
