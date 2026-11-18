/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
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

// Keep synchronous chat backup outside this result-delivery fixture.
vi.mock('../store-backup', async original => ({ ...await original<typeof import('../store-backup')>(), flushSyncStoreBackup: vi.fn() }))
const api = vi.hoisted(() => ({ native: false, call: vi.fn() }))
vi.mock('../../api/backend', async original => ({ ...await original<typeof import('../../api/backend')>(), isTauri: () => api.native, backendCall: api.call }))
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useScheduleStore, SCHEDULE_KEY } from '../../stores/scheduleStore'
import { finishScheduleRun, readSchedules, type StudioSchedule, type ScheduleDelivery } from '../schedules'
import { deliverScheduleResults, scheduleResultMessageId, scheduleRunText, scheduleResultTxt, scheduleResultFilename } from '../schedule-results'

const slot = 1_800_000_000_000
const profile = { id: 'agenda-test', name: 'Tarefa independente', instructions: 'Leia e responda.', model: 'openai::test' }
let origin: string, target: string
function pending(mode: ScheduleDelivery['mode']): StudioSchedule {
  const item: StudioSchedule = { id: 'result-proof', name: 'Relatório diário', goal: 'Faça um relatório.', agent: profile, timezone: 'America/Sao_Paulo', rule: { kind: 'interval', minutes: 60, startAt: slot }, status: 'running', enabled: true, nextAt: slot + 3_600_000, conversationId: origin, resultDestination: mode, history: [{ startedAt: slot, scheduledAt: slot, status: 'running' }] }
  const finished = finishScheduleRun(item, 'completed', '# Relatório\n- Resultado verificado.', slot + 1000, target)
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ version: 1, items: [finished] }))
  useScheduleStore.getState().refresh()
  return useScheduleStore.getState().items[0]
}
const last = () => useScheduleStore.getState().items[0].history!.at(-1)!
beforeEach(async () => {
  localStorage.clear(); api.native = false; api.call.mockReset()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  vi.spyOn(useChatStore.persist, 'hasHydrated').mockReturnValue(true)
  useGenerationStore.setState({ generating: {} })
  useModelStore.setState({ activeModel: 'user-selected-model' })
  origin = useChatStore.getState().createConversation('openai::test', '', 'lu', { activate: false })
  target = useChatStore.getState().createConversation('user-selected-model', '')
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, options: unknown, work?: (lock: object) => unknown) => (typeof options === 'function' ? options : work!)({}) } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('result delivery is separate from agent execution', () => {
  it('waits for the captured chat to stop, preserving selection and model', async () => {
    pending('chat'); useGenerationStore.setState({ generating: { [target]: true } })
    await deliverScheduleResults(vi.fn(), new AbortController().signal)
    expect(last().delivery?.state).toBe('pending')
    const other = useChatStore.getState().createConversation('other-model', '')
    useGenerationStore.setState({ generating: {} })
    await deliverScheduleResults(vi.fn(), new AbortController().signal)
    expect(last().delivery?.state).toBe('done')
    const messages = useChatStore.getState().conversations.find(chat => chat.id === target)!.messages
    expect(messages).toHaveLength(1); expect(messages[0].content).toContain('Resultado verificado')
    expect(useChatStore.getState().activeConversationId).toBe(other)
    expect(useModelStore.getState().activeModel).toBe('user-selected-model')
    expect(api.call).not.toHaveBeenCalled()
    // Explicitly retrying delivery cannot duplicate a result already in the chat.
    const items = useScheduleStore.getState().items
    items[0].history![0].delivery!.state = 'pending'
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ version: 1, items })); useScheduleStore.getState().refresh()
    await deliverScheduleResults(vi.fn(), new AbortController().signal)
    expect(useChatStore.getState().conversations.find(chat => chat.id === target)!.messages).toHaveLength(1)
  })
  it('keeps a popup pending until the user acknowledges it', async () => {
    pending('popup'); let close!: () => void
    const show = vi.fn(() => new Promise<void>(resolve => { close = resolve }))
    const delivery = deliverScheduleResults(show, new AbortController().signal, 'popup')
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce())
    expect(last().delivery?.state).toBe('pending'); close(); await delivery
    expect(last().delivery?.state).toBe('done')
  })
  it('an unacknowledged popup survives an app interruption', async () => {
    pending('popup'); const controller = new AbortController()
    await deliverScheduleResults(async () => { controller.abort() }, controller.signal, 'popup')
    expect(last().delivery?.state).toBe('pending')
  })
  it('saves a TXT through native code and records the returned path', async () => {
    const item = pending('txt'); api.native = true; api.call.mockResolvedValue('C:/Documentos/BionicLLM Studio/Agenda/result.txt')
    await deliverScheduleResults(vi.fn(), new AbortController().signal)
    expect(api.call).toHaveBeenCalledWith('save_schedule_result', expect.objectContaining({ filename: scheduleResultFilename(item, last()), content: expect.stringContaining('Resultado verificado') }))
    expect(last().delivery).toMatchObject({ state: 'done', path: 'C:/Documentos/BionicLLM Studio/Agenda/result.txt' })
    expect(useScheduleStore.getState().items[0].status).toBe('completed')
  })
  it('an export failure does not fail or rerun a completed agent', async () => {
    pending('txt'); api.native = true; api.call.mockRejectedValue(new Error('Disco cheio'))
    await deliverScheduleResults(vi.fn(), new AbortController().signal)
    expect(last().delivery).toMatchObject({ state: 'failed', error: 'Disco cheio' })
    expect(useScheduleStore.getState().items[0].status).toBe('completed')
    await deliverScheduleResults(vi.fn(), new AbortController().signal); expect(api.call).toHaveBeenCalledOnce()
  })
  it('retains history when the selected chat no longer exists', async () => {
    pending('chat'); useChatStore.setState(state => ({ conversations: state.conversations.filter(chat => chat.id !== target) }))
    await deliverScheduleResults(vi.fn(), new AbortController().signal)
    expect(last().delivery?.state).toBe('failed')
    expect(last().result).toContain('Resultado verificado'); expect(last().conversationId).toBe(origin)
  })
})

describe('complete results and compatibility', () => {
  it('exports the complete response instead of the 12k schedule preview', () => {
    const item = pending('txt'); const full = 'Texto completo\n' + 'x'.repeat(20_000)
    useChatStore.getState().addMessage(origin, { id: scheduleResultMessageId(item.id, slot), role: 'assistant', content: full, timestamp: slot })
    expect(scheduleRunText(item, last())).toBe(full)
    expect(scheduleResultTxt(item, last())).toContain(full)
    expect(scheduleResultFilename(item, last())).toMatch(/^[a-zA-Z0-9_.-]+\.txt$/)
  })
  it('reads full older background notices, including multiline goals', () => {
    const item = pending('chat'); const goal = 'Primeira linha\nSegunda linha'; const full = 'Primeiro resultado\nSegundo resultado'
    useChatStore.getState().addMessage(origin, { id: 'goal', role: 'user', content: goal, timestamp: slot })
    useChatStore.getState().addMessage(origin, { id: 'bg-proof', role: 'system', notice: 'info', content: 'Background agent [proof] finished: ' + goal + '\n' + full, timestamp: slot })
    expect(scheduleRunText(item, last())).toBe(full)
  })
  it('older agendas do not receive retroactive popups and invalid destinations fail closed', () => {
    const item = pending('popup'); delete item.resultDestination; delete item.history![0].delivery
    const raw = JSON.stringify({ version: 1, items: [item] }); expect(readSchedules(raw)[0].resultDestination).toBe('history')
    expect(readSchedules(raw)[0].history![0].delivery).toBeUndefined()
    expect(() => readSchedules(JSON.stringify({ version: 1, items: [{ ...item, resultDestination: 'bad' }] }))).toThrow()
  })
})

it('requires native save confirmation before reporting a TXT as saved', async () => {
  pending('txt'); api.native = true; api.call.mockResolvedValue(undefined)
  await deliverScheduleResults(vi.fn(), new AbortController().signal)
  expect(last().delivery?.state).toBe('failed')
  expect(last().delivery?.error).toContain('não confirmou')
  expect(useScheduleStore.getState().items[0].status).toBe('completed')
})

it('a pending popup never blocks delivery of another task TXT', async () => {
  const popup = pending('popup')
  const txt = { ...pending('txt'), id: 'txt-while-popup' }
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ version: 1, items: [popup, txt] })); useScheduleStore.getState().refresh()
  let close!: () => void
  const show = vi.fn(() => new Promise<void>(resolve => { close = resolve }))
  const popupDelivery = deliverScheduleResults(show, new AbortController().signal, 'popup')
  await vi.waitFor(() => expect(show).toHaveBeenCalledOnce())
  api.native = true; api.call.mockResolvedValue('C:/Documentos/Agenda/result.txt')
  await deliverScheduleResults(vi.fn(), new AbortController().signal, 'background')
  expect(useScheduleStore.getState().items.find(item => item.id === txt.id)!.history![0].delivery?.state).toBe('done')
  expect(useScheduleStore.getState().items.find(item => item.id === popup.id)!.history![0].delivery?.state).toBe('pending')
  close(); await popupDelivery
})
