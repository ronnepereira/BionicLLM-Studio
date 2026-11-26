import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { nextOccurrence, readSchedules, scheduleInput, scheduleDestination, type ScheduleDestination, type StudioSchedule, type ScheduleRule } from '../lib/schedules'
import type { StudioAgentProfile } from '../lib/agent-profiles'

export const SCHEDULE_KEY = 'bionic-schedules-v1'
// The profile store registers its own deletion, keeping this module independent.
let removeLinkedProfile: (agentId: string) => void = () => {}
export function registerScheduledProfileRemoval(remove: (agentId: string) => void): void {
  removeLinkedProfile = remove
}
interface ScheduleState {
  items: StudioSchedule[]
  error: string | null
  refresh: () => void
  add: (name: string, goal: string, agent: StudioAgentProfile, timezone: string, rule: ScheduleRule, destination?: ScheduleDestination) => Promise<void>
  update: (id: string, name: string, goal: string, agent: StudioAgentProfile, timezone: string, rule: ScheduleRule, destination?: ScheduleDestination) => Promise<void>
  toggle: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}
export const useScheduleStore = create<ScheduleState>((set) => ({
  items: [], error: null,
  refresh: () => {
    try { set({ items: readSchedules(localStorage.getItem(SCHEDULE_KEY)), error: null }) }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
  },
  add: async (name, goal, agent, timezone, rule, destination) => {
    const input = scheduleInput(name, goal, agent, timezone, rule)
    const nextAt = nextOccurrence(input.rule, timezone, Date.now())
    if (!nextAt) throw new Error('A data já passou ou o horário não existe nesse fuso. Escolha outro horário.')
    await changeSchedules(items => {
      if (items.length >= 200) throw new Error('Limite de 200 agendamentos atingido.')
      return [...items, { ...input, resultDestination: scheduleDestination(destination), id: uuid(), enabled: true, nextAt, status: 'ready' }]
    })
  },
  update: async (id, name, goal, agent, timezone, rule, destination) => {
    const input = scheduleInput(name, goal, agent, timezone, rule)
    await changeSchedules(items => {
      const current = items.find(item => item.id === id)
      if (!current) throw new Error('Este agendamento foi removido.')
      if (current.status === 'running') throw new Error('Aguarde ou cancele a execução antes de editar a tarefa.')
      const changedRule = current.timezone !== timezone || JSON.stringify(current.rule) !== JSON.stringify(input.rule)
      const nextAt = changedRule ? nextOccurrence(input.rule, timezone, Date.now()) : current.nextAt
      if (changedRule && nextAt === null) throw new Error('Escolha uma data futura para a tarefa.')
      return items.map(item => item.id === id ? { ...item, ...input, resultDestination: scheduleDestination(destination ?? current.resultDestination), nextAt, ...(changedRule ? { lastSlot: undefined } : {}) } : item)
    })
  },
  toggle: id => changeSchedules(items => items.map(item => {
    if (item.id !== id) return item
    if (item.enabled) return { ...item, enabled: false }
    if (item.status === 'running') throw new Error('Aguarde o término ou cancele a execução atual.')
    const nextAt = nextOccurrence(item.rule, item.timezone, Date.now(), item.lastSlot)
    if (!nextAt) throw new Error('Este horário já passou. Crie um novo agendamento.')
    return { ...item, enabled: true, nextAt, status: 'ready', cancelRequested: false }
  })),
  cancel: id => changeSchedules(items => items.map(item => item.id === id ? { ...item, enabled: false, cancelRequested: item.status === 'running' } : item)),
  remove: async id => {
    let agentId: string | undefined
    await changeSchedules(items => {
      agentId = items.find(item => item.id === id)?.agent.id
      // As with deleting a profile, removing its schedules cancels live runs.
      return agentId ? items.filter(item => item.agent.id !== agentId) : items
    })
    // Only remove the profile after the durable schedule write succeeded.
    if (agentId) removeLinkedProfile(agentId)
  },
}))

/** All windows and both UI/runtime mutate under one lock, from fresh durable data.
 * A failed write throws before the agent can perform any work. No quota pruning. */
export async function changeSchedules(change: (items: StudioSchedule[]) => StudioSchedule[]): Promise<void> {
  if (!globalThis.navigator?.locks) throw new Error('O agendador precisa de um navegador ou WebView2 com bloqueio de tarefas disponível.')
  await navigator.locks.request('bionic-schedule-data', async () => {
    try {
      const items = change(readSchedules(localStorage.getItem(SCHEDULE_KEY)))
      const payload = JSON.stringify({ version: 1, items })
      if (localStorage.getItem(SCHEDULE_KEY) === payload) return
      localStorage.setItem(SCHEDULE_KEY, payload)
      if (localStorage.getItem(SCHEDULE_KEY) !== payload) throw new Error('Não foi possível confirmar a gravação da agenda.')
      useScheduleStore.setState({ items, error: null })
    } catch (error) {
      useScheduleStore.setState({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })
}
