import { changeSchedules, useScheduleStore } from '../stores/scheduleStore'
import { finishScheduleRun, localSlot, nextOccurrence, type StudioSchedule } from './schedules'

// One owner at a time across windows, including while a model/tool is running.
// Only a durable claim permits execution. Unknown/crashed work is paused, never replayed.
export async function tickSchedules(
  execute: (item: StudioSchedule, signal: AbortSignal, onConversation: (id: string) => Promise<void>) => Promise<{ status: 'completed' | 'failed' | 'cancelled'; result: string }>,
  signal: AbortSignal,
  now = Date.now(),
  currentConversation: () => string | null = () => null,
): Promise<void> {
  if (signal.aborted) return
  if (!navigator.locks) throw new Error('O agendador precisa de um navegador ou WebView2 com bloqueio de tarefas disponível.')
  await navigator.locks.request('bionic-schedule-execution', { ifAvailable: true }, async lock => {
    if (!lock || signal.aborted) return
    let claimed: StudioSchedule | undefined
    await changeSchedules(items => items.map(item => {
      if (item.status === 'running') return { ...finishScheduleRun(item, 'interrupted', 'A execução anterior foi interrompida. Revise a conversa antes de retomar a agenda; possíveis ações já realizadas não serão repetidas automaticamente.', now), enabled: false, cancelRequested: false }
      if (!item.enabled || item.nextAt === null || item.nextAt > now) return item
      const lastSlot = localSlot(item.nextAt, item.timezone)
      const nextAt = item.rule.kind === 'once' ? null : nextOccurrence(item.rule, item.timezone, now, lastSlot)
      if (now - item.nextAt > 90_000) return { ...finishScheduleRun(item, 'missed', 'Horário perdido com o aplicativo fechado, suspenso ou ocupado. Esta ocorrência não foi executada.', now), enabled: nextAt !== null, nextAt, lastSlot }
      if (claimed) return item
      claimed = { ...item, status: 'running', lastAt: item.nextAt, lastSlot, nextAt, enabled: nextAt !== null, cancelRequested: false, conversationId: undefined, result: undefined, history: [...(item.history ?? []), { startedAt: now, scheduledAt: item.nextAt, status: 'running' }] }
      return claimed
    }))
    if (!claimed) return
    const entry = claimed
    const controller = new AbortController()
    const stop = () => controller.abort()
    signal.addEventListener('abort', stop, { once: true })
    const checkCancellation = () => {
      const saved = useScheduleStore.getState().items.find(item => item.id === entry.id)
      if (!saved || saved.cancelRequested) stop()
    }
    const unsubscribe = useScheduleStore.subscribe(checkCancellation)
    checkCancellation()
    if (signal.aborted) stop()
    if (controller.signal.aborted) {
      unsubscribe()
      signal.removeEventListener('abort', stop)
      return
    }
    try {
      const outcome = await execute(entry, controller.signal, async conversationId => {
        await changeSchedules(items => items.map(item => item.id === entry.id ? { ...item, conversationId, history: item.history?.map((run, index) => index === item.history!.length - 1 && run.status === 'running' ? { ...run, conversationId } : run) } : item))
      })
      await changeSchedules(items => items.map(item => item.id === entry.id ? {
        ...finishScheduleRun(item, outcome.status, outcome.result, Date.now(), currentConversation()), cancelRequested: false,
        // Errors/cancellation require a deliberate resume, preventing repeated failing side effects.
        enabled: outcome.status === 'completed' && item.enabled,
      } : item))
    } catch (error) {
      await changeSchedules(items => items.map(item => item.id === entry.id ? { ...finishScheduleRun(item, controller.signal.aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error), Date.now(), currentConversation()), enabled: false, cancelRequested: false } : item))
    } finally {
      unsubscribe()
      signal.removeEventListener('abort', stop)
    }
  })
}
