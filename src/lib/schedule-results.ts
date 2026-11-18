import { idbStorage, hasFailedRead } from './idbStorage'
import { v5 as uuid } from 'uuid'
import type { Conversation } from '../types/chat'
import type { StudioSchedule, ScheduleRun, ScheduleDestination } from './schedules'
import { useChatStore, flushChatPersist } from '../stores/chatStore'
import { useGenerationStore } from '../stores/generationStore'
import { changeSchedules, useScheduleStore } from '../stores/scheduleStore'
import { backendCall, isTauri } from '../api/backend'
import { saveOrShare, type SaveOutcome } from './save-or-share'

export const SCHEDULE_DESTINATIONS: { id: ScheduleDestination; label: string }[] = [
  { id: 'history', label: 'Somente no histórico' }, { id: 'chat', label: 'Exibir no chat atual' },
  { id: 'popup', label: 'Abrir em pop-up' }, { id: 'txt', label: 'Salvar automaticamente em TXT' },
]
export const scheduleStatusText = { ready: 'Agendada', running: 'Em execução', completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada', interrupted: 'Interrompida', missed: 'Horário perdido' }
export function scheduleResultMessageId(id: string, slot: number, channel = 'history') { return uuid(`bionicllm-agenda/${channel}/${id}/${slot}`, uuid.URL) }
export function scheduleRunText(item: StudioSchedule, run: ScheduleRun, conversations: readonly Conversation[] = useChatStore.getState().conversations): string {
  const conversation = conversations.find(value => value.id === run.conversationId)
  const answer = conversation?.messages.find(message => message.id === scheduleResultMessageId(item.id, run.scheduledAt))
  if (answer) return answer.content
  // Older versions stored the full result in an activity notice. Read it without deleting it.
  const goal = conversation?.messages.find(message => message.role === 'user')?.content
  if (goal) {
    for (const message of [...(conversation?.messages ?? [])].reverse()) {
      if (message.role !== 'system' || !/^Background agent \[[^\]]+\] (finished|failed|cancelled): /.test(message.content)) continue
      const marker = ': ' + goal + '\n'
      const index = message.content.indexOf(marker)
      if (index >= 0) return message.content.slice(index + marker.length)
    }
  }
  return run.result || ''
}
export function scheduleResultFilename(item: StudioSchedule, run: ScheduleRun) {
  const name = item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 35) || 'agenda'
  return `${name}-${item.id}-${run.scheduledAt}.txt`
}
export function scheduleResultTxt(item: StudioSchedule, run: ScheduleRun) {
  const date = (value: number) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: item.timezone }).format(value)
  return `BionicLLM Studio · Resultado da Agenda\nTarefa: ${item.name}\nSituação: ${scheduleStatusText[run.status]}\nAgendada para: ${date(run.scheduledAt)} (${item.timezone})\n${run.finishedAt ? 'Finalizada em: ' + date(run.finishedAt) + '\n' : ''}Modelo: ${item.agent.model}\n\n${scheduleRunText(item, run)}\n`
}
export async function exportScheduleTxt(item: StudioSchedule, run: ScheduleRun): Promise<SaveOutcome> {
  return saveOrShare({ filename: scheduleResultFilename(item, run), mime: 'text/plain;charset=utf-8', text: scheduleResultTxt(item, run) }, { extension: 'txt', extLabel: 'Texto' })
}
export async function updateScheduleDelivery(id: string, slot: number, change: (run: ScheduleRun) => ScheduleRun) {
  await changeSchedules(items => items.map(item => item.id === id ? { ...item, history: item.history?.map(run => run.scheduledAt === slot ? change(run) : run) } : item))
}

/** Delivery has its own lock. A popup/export cannot block or replay the scheduled agent. */
export async function deliverScheduleResults(show: (item: StudioSchedule, run: ScheduleRun) => Promise<void>, signal: AbortSignal, channel: 'popup' | 'background' = 'background'): Promise<void> {
  if (signal.aborted || !navigator.locks || !useChatStore.persist.hasHydrated()) return
  await navigator.locks.request('bionic-schedule-result-delivery-' + channel, { ifAvailable: true }, async lock => {
    if (!lock || signal.aborted) return
    const candidates = useScheduleStore.getState().items.flatMap(item => (item.history ?? []).filter(run => run.delivery?.state === 'pending' && run.status !== 'running' && (channel === 'popup' ? run.delivery.mode === 'popup' : run.delivery.mode !== 'popup')).map(run => ({ item, run })))
      .sort((a, b) => (a.run.finishedAt ?? 0) - (b.run.finishedAt ?? 0))
    for (const candidate of candidates) {
      if (signal.aborted) return
      const item = useScheduleStore.getState().items.find(value => value.id === candidate.item.id)
      const run = item?.history?.find(value => value.scheduledAt === candidate.run.scheduledAt)
      if (!item || !run || run.delivery?.state !== 'pending') continue
      const delivery = run.delivery
      if (delivery.mode === 'chat' && delivery.targetConversationId && useGenerationStore.getState().generating[delivery.targetConversationId]) continue
      try {
        let path: string | undefined
        if (delivery.mode === 'popup') await show(item, run)
        else if (delivery.mode === 'txt') {
          if (isTauri()) {
            path = await backendCall<string>('save_schedule_result', { filename: scheduleResultFilename(item, run), content: scheduleResultTxt(item, run) })
            if (!path || typeof path !== 'string') throw new Error('O aplicativo não confirmou a gravação do TXT. O resultado permanece no histórico.')
          }
          else {
            const saved = await saveOrShare({ filename: scheduleResultFilename(item, run), mime: 'text/plain;charset=utf-8', text: scheduleResultTxt(item, run) }, { via: 'anchor' })
            if (saved.status === 'error') throw new Error(saved.error)
            if (saved.status === 'cancelled') throw new Error('O salvamento foi cancelado. O resultado continua no histórico.')
          }
        } else {
          const target = useChatStore.getState().conversations.find(chat => chat.id === delivery.targetConversationId)
          if (!target) throw new Error('Não havia chat selecionado ao concluir, ou ele foi removido. O resultado continua no histórico da Agenda.')
          if (target.id !== run.conversationId) {
            const id = scheduleResultMessageId(item.id, run.scheduledAt, 'delivery')
            if (!target.messages.some(message => message.id === id)) useChatStore.getState().addMessage(target.id, {
              id, role: 'assistant', content: `### Resultado da Agenda: ${item.name}\n${scheduleStatusText[run.status]}\n\n${scheduleRunText(item, run)}`, timestamp: run.finishedAt ?? Date.now(),
            })
            await flushChatPersist()
            const raw = await idbStorage.getItem('chat-conversations')
            const saved: unknown = raw ? JSON.parse(raw) : null
            const savedConversations = (saved as { state?: { conversations?: Conversation[] } } | null)?.state?.conversations
            if (hasFailedRead('chat-conversations') || !Array.isArray(savedConversations) || !savedConversations.find(chat => chat.id === target.id)?.messages.some(message => message.id === id)) throw new Error('Não foi possível confirmar a gravação no chat atual. O resultado permanece na conversa da Agenda.')
          }
        }
        if (signal.aborted) return
        await updateScheduleDelivery(item.id, run.scheduledAt, current => ({ ...current, delivery: { ...current.delivery!, state: 'done', error: undefined, ...(path ? { path } : {}) } }))
      } catch (error) {
        if (signal.aborted) return // An unacknowledged popup remains available after reopening.
        await updateScheduleDelivery(item.id, run.scheduledAt, current => ({ ...current, delivery: { ...current.delivery!, state: 'failed', error: error instanceof Error ? error.message : String(error) } }))
      }
    }
  })
}
