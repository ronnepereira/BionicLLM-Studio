// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Node 26 exposes an undefined localStorage getter even in this jsdom setup.
vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) }, clear: () => values.clear(),
  } })
})

import { calendarOccurrences, localEpochs, nextOccurrence, scheduleRule, readSchedules, type StudioSchedule } from '../schedules'
import { tickSchedules } from '../schedule-runtime'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { SCHEDULE_KEY, useScheduleStore } from '../../stores/scheduleStore'

const now = Date.parse('2026-11-02T12:00:00Z')
const agent = { id: 'agent-test', name: 'Pesquisador', instructions: 'Cite as fontes.', model: 'openai::model' }
const item = (over: Partial<StudioSchedule> = {}): StudioSchedule => ({ id: 'task-test', name: 'Pesquisa', goal: 'Pesquise.', agent, timezone: 'America/Sao_Paulo', rule: { kind: 'interval', minutes: 10, startAt: now }, enabled: true, nextAt: now, status: 'ready', ...over })
const save = (items: StudioSchedule[]) => { localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ version: 1, items })); useScheduleStore.getState().refresh() }

// Models the browser's exclusive cross-window locks, including ifAvailable.
beforeEach(() => {
  localStorage.clear()
  useAgentProfileStore.setState({ profiles: [] })
  useScheduleStore.setState({ items: [], error: null })
  const held = new Set<string>()
  const queues = new Map<string, Promise<unknown>>()
  vi.stubGlobal('navigator', { locks: { request: async (name: string, optionsOrCallback: unknown, callback?: (lock: object | null) => Promise<unknown>) => {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback as { ifAvailable?: boolean }
    const work = (callback ?? optionsOrCallback) as (lock: object | null) => Promise<unknown>
    if (options.ifAvailable && held.has(name)) return work(null)
    const previous = queues.get(name) ?? Promise.resolve()
    const run = previous.then(async () => { held.add(name); try { return await work({ name }) } finally { held.delete(name) } })
    queues.set(name, run.catch(() => {}))
    return run
  } } })
})

it('deleting an agenda removes its agent and sibling agendas, preserving unrelated agents', async () => {
  const id = useAgentProfileStore.getState().add('Clima', 'Informe o clima.', agent.model)
  const other = useAgentProfileStore.getState().add('Outro', 'Informe a hora.', agent.model)
  const profile = useAgentProfileStore.getState().profiles.find(row => row.id === id)!
  save([item({ id: 'first', agent: profile }), item({ id: 'sibling', agent: profile }), item({ id: 'unrelated', agent: { ...agent, id: other } })])
  await useScheduleStore.getState().remove('first')
  useScheduleStore.getState().refresh()
  await useAgentProfileStore.persist.rehydrate()
  expect(useScheduleStore.getState().items.map(row => row.id)).toEqual(['unrelated'])
  expect(useAgentProfileStore.getState().profiles.map(row => row.id)).toEqual([other])
})

it('keeps the linked agent if deleting its agenda cannot be saved', async () => {
  const id = useAgentProfileStore.getState().add('Clima', 'Informe o clima.', agent.model)
  save([item({ agent: useAgentProfileStore.getState().profiles[0] })])
  const failure = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('disk full') })
  try {
    await expect(useScheduleStore.getState().remove('task-test')).rejects.toThrow('disk full')
    expect(useAgentProfileStore.getState().profiles.some(row => row.id === id)).toBe(true)
    expect(useScheduleStore.getState().items).toHaveLength(1)
  } finally { failure.mockRestore() }
})

describe('schedule time calculations', () => {
  it('runs daily in the task zone and skips months without the selected day', () => {
    expect(scheduleRule({ kind: 'daily', time: '09:00' })).toEqual({ kind: 'daily', time: '09:00' })
    expect(nextOccurrence({ kind: 'daily', time: '09:00' }, 'America/Sao_Paulo', now)).toBe(now + 86_400_000)
    expect(nextOccurrence({ kind: 'monthly', time: '09:00', day: 31 }, 'America/Sao_Paulo', Date.parse('2026-01-31T12:00:00Z'))).toBe(Date.parse('2026-03-31T12:00:00Z'))
    expect(() => scheduleRule({ kind: 'monthly', time: '09:00', day: 32 })).toThrow()
    expect(localEpochs('2011-12-30T10:00', 'Pacific/Apia')).toEqual([])
    expect(localEpochs('2026-04-05T01:45', 'Australia/Lord_Howe')).toHaveLength(2)
  })
  it('interprets a one-off wall time in the selected zone, independent of host timezone', () => {
    expect(nextOccurrence({ kind: 'once', local: '2026-11-02T09:01' }, 'America/Sao_Paulo', now)).toBe(now + 60_000)
    expect(nextOccurrence({ kind: 'once', local: '2026-11-02T09:00' }, 'America/Sao_Paulo', now)).toBeNull()
    expect(() => scheduleRule({ kind: 'once', local: '2026-02-30T09:00' })).toThrow()
  })
  it('skips DST gaps and executes a repeated wall time only once', () => {
    const rule = { kind: 'weekly', time: '02:30', days: [0] } as const
    expect(nextOccurrence({ ...rule, days: [...rule.days] }, 'America/New_York', Date.parse('2026-03-08T05:00:00Z'))).toBe(Date.parse('2026-03-15T06:30:00Z'))
    const fall = { kind: 'weekly', time: '01:30', days: [0] } as const
    const first = nextOccurrence({ ...fall, days: [...fall.days] }, 'America/New_York', Date.parse('2026-11-01T04:00:00Z'))!
    expect(first).toBe(Date.parse('2026-11-01T05:30:00Z'))
    expect(nextOccurrence({ ...fall, days: [...fall.days] }, 'America/New_York', first, '2026-11-01T01:30')).toBe(Date.parse('2026-11-08T06:30:00Z'))
  })
  it('keeps interval phase without replaying all missed occurrences', () => {
    expect(nextOccurrence({ kind: 'interval', minutes: 10, startAt: now }, 'UTC', now + 35 * 60_000)).toBe(now + 40 * 60_000)
    expect(() => scheduleRule({ kind: 'interval', minutes: 0, startAt: now })).toThrow()
    expect(() => readSchedules('{"version":1,"items":[{}]}')).toThrow()
  })
})

describe('durable schedule execution', () => {
  it('keeps every execution and its conversation after reload and edits', async () => {
    save([item()])
    const execute = vi.fn(async (_item, _signal, onConversation) => {
      await onConversation(`conversation-${execute.mock.calls.length}`)
      return { status: 'completed' as const, result: `Result ${execute.mock.calls.length}` }
    })
    await tickSchedules(execute, new AbortController().signal, now)
    await tickSchedules(execute, new AbortController().signal, now + 600_000)
    await useScheduleStore.getState().update('task-test', 'Edited', 'New task instructions', agent, 'America/Sao_Paulo', item().rule)
    useScheduleStore.getState().refresh()
    const saved = useScheduleStore.getState().items[0]
    expect(saved.history).toHaveLength(2)
    expect(saved.history?.map(run => [run.status, run.result, run.conversationId])).toEqual([
      ['completed', 'Result 1', 'conversation-1'], ['completed', 'Result 2', 'conversation-2'],
    ])
    expect(saved.nextAt).toBe(now + 1_200_000)
    expect(saved.goal).toBe('New task instructions')
    expect(saved.agent.instructions).toBe(agent.instructions)
  })
  it('preserves a running task when an edit is rejected', async () => {
    save([item({ status: 'running' })])
    await expect(useScheduleStore.getState().update('task-test', 'Edited', 'New task', agent, 'UTC', item().rule)).rejects.toThrow(/execução/)
    expect(readSchedules(localStorage.getItem(SCHEDULE_KEY))[0].goal).toBe('Pesquise.')
  })
  it('claims before side effects and does not execute the same occurrence twice', async () => {
    save([item()])
    const execute = vi.fn(async () => {
      expect(readSchedules(localStorage.getItem(SCHEDULE_KEY))[0]).toMatchObject({ status: 'running', lastAt: now, nextAt: now + 600_000 })
      return { status: 'completed' as const, result: 'Feito' }
    })
    await tickSchedules(execute, new AbortController().signal, now)
    await tickSchedules(execute, new AbortController().signal, now)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(useScheduleStore.getState().items[0].status).toBe('completed')
  })
  it('recovers an interrupted claim paused, without retrying external effects', async () => {
    save([item({ status: 'running', lastAt: now - 600_000 })])
    const execute = vi.fn()
    await tickSchedules(execute, new AbortController().signal, now)
    expect(execute).not.toHaveBeenCalled()
    expect(useScheduleStore.getState().items[0]).toMatchObject({ status: 'interrupted', enabled: false })
  })
  it('skips stale occurrences and never runs a paused or future schedule', async () => {
    save([item({ nextAt: now - 120_000 }), item({ id: 'paused', enabled: false }), item({ id: 'future', nextAt: now + 600_000 })])
    const execute = vi.fn()
    await tickSchedules(execute, new AbortController().signal, now)
    expect(execute).not.toHaveBeenCalled()
    expect(useScheduleStore.getState().items[0]).toMatchObject({ status: 'missed', nextAt: now + 600_000 })
  })
  it('does not run if writing the claim fails or saved data is invalid', async () => {
    save([item()])
    const execute = vi.fn()
    const writing = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Disco cheio') })
    await expect(tickSchedules(execute, new AbortController().signal, now)).rejects.toThrow('Disco cheio')
    expect(execute).not.toHaveBeenCalled()
    writing.mockRestore()
    localStorage.setItem(SCHEDULE_KEY, 'broken data')
    await expect(tickSchedules(execute, new AbortController().signal, now)).rejects.toThrow()
    expect(localStorage.getItem(SCHEDULE_KEY)).toBe('broken data')
  })
  it('keeps a second tick/window from running while a task is in flight and cancels through its real signal', async () => {
    save([item()])
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const execute = vi.fn(async (_item: StudioSchedule, signal: AbortSignal) => {
      entered()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { status: 'cancelled' as const, result: 'Cancelado' }
    })
    const first = tickSchedules(execute, new AbortController().signal, now)
    await started
    await tickSchedules(execute, new AbortController().signal, now)
    expect(execute).toHaveBeenCalledTimes(1)
    await useScheduleStore.getState().cancel('task-test')
    await first
    expect(useScheduleStore.getState().items[0]).toMatchObject({ enabled: false, status: 'cancelled' })
  })
})

it('captures the chat selected at completion without changing execution history', async () => {
  save([item({ resultDestination: 'chat' })])
  let selected = 'before-execution'
  await tickSchedules(async () => { selected = 'selected-at-completion'; return { status: 'completed', result: 'Resposta preservada.' } }, new AbortController().signal, now, () => selected)
  expect(useScheduleStore.getState().items[0].history!.at(-1)).toMatchObject({ result: 'Resposta preservada.', delivery: { mode: 'chat', state: 'pending', targetConversationId: 'selected-at-completion' } })
})


describe('agent deletion cascades to its schedules', () => {
  it('removes every linked schedule durably while preserving other agents and tasks', async () => {
    const profiles = useAgentProfileStore.getState()
    const id = profiles.add('Teste', 'Executar teste.', 'openai::model')
    const otherId = profiles.add('Outro', 'Outra tarefa.', 'openai::model')
    const own = useAgentProfileStore.getState().profiles.find(p => p.id === id)!
    save([item({ agent: own }), item({ id: 'completed', agent: own, status: 'completed' }), item({ id: 'other', agent: { ...agent, id: otherId } })])
    await profiles.remove(id)
    await useAgentProfileStore.persist.rehydrate()
    useScheduleStore.getState().refresh()
    expect(useAgentProfileStore.getState().profiles.some(p => p.id === id)).toBe(false)
    expect(useAgentProfileStore.getState().profiles.some(p => p.id === otherId)).toBe(true)
    expect(useScheduleStore.getState().items.map(task => task.id)).toEqual(['other'])
    expect(readSchedules(localStorage.getItem(SCHEDULE_KEY)).map(task => task.id)).toEqual(['other'])
  })

  it('keeps the agent when deleting its saved schedules fails', async () => {
    const id = useAgentProfileStore.getState().add('Teste', 'Executar teste.', 'openai::model')
    save([item({ agent: { ...agent, id } })])
    const writing = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Disco cheio') })
    try {
      await expect(useAgentProfileStore.getState().remove(id)).rejects.toThrow('Disco cheio')
      expect(useAgentProfileStore.getState().profiles.some(p => p.id === id)).toBe(true)
      expect(readSchedules(localStorage.getItem(SCHEDULE_KEY))).toHaveLength(1)
    } finally { writing.mockRestore() }
  })

  it('aborts a running linked task and does not resurrect it when execution settles', async () => {
    const id = useAgentProfileStore.getState().add('Teste', 'Executar teste.', 'openai::model')
    save([item({ agent: { ...agent, id } })])
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let cancelled = false
    const run = tickSchedules(async (_task, signal) => {
      entered()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve() }, { once: true }))
      return { status: 'cancelled', result: 'Cancelado' }
    }, new AbortController().signal, now)
    await started
    await useAgentProfileStore.getState().remove(id)
    await run
    expect(cancelled).toBe(true)
    useScheduleStore.getState().refresh()
    expect(useScheduleStore.getState().items).toEqual([])
    expect(readSchedules(localStorage.getItem(SCHEDULE_KEY))).toEqual([])
  })
})

it('shows all hourly occurrences chronologically within the selected calendar day', () => {
 const start=Date.parse('2026-11-18T03:00:00Z') // midnight Sao Paulo
 const schedule=item({rule:{kind:'interval',minutes:60,startAt:start+60000},nextAt:start+60000})
 const result=calendarOccurrences(schedule,start,start+86400000,start)
 expect(result.more).toBe(false)
 expect(result.times).toHaveLength(24)
 expect(result.times[0]).toBe(start+60000)
 expect(result.times[23]).toBe(start+23*3600000+60000)
 const bounded=calendarOccurrences({...schedule,rule:{kind:'interval',minutes:1,startAt:start+60000}},start,start+86400000,start,3)
 expect(bounded.times).toHaveLength(3)
 expect(bounded.more).toBe(true)
 expect(calendarOccurrences({...schedule,enabled:false},start,start+86400000,start).times).toEqual([])
})
