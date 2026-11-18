import { agentProfileInput, type StudioAgentProfile } from './agent-profiles'
import { isRecord } from '../types/json-guards'

export type ScheduleRule =
  | { kind: 'once'; local: string }
  | { kind: 'weekly'; time: string; days: number[] }
  | { kind: 'daily'; time: string }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'interval'; minutes: number; startAt: number }
export type ScheduleDestination = 'history' | 'chat' | 'popup' | 'txt'
export interface ScheduleDelivery {
  mode: Exclude<ScheduleDestination, 'history'>
  state: 'pending' | 'done' | 'failed'
  targetConversationId?: string
  path?: string
  error?: string
}
export function scheduleDestination(value: unknown): ScheduleDestination {
  if (value === undefined || value === 'history') return 'history'
  if (value === 'chat' || value === 'popup' || value === 'txt') return value
  throw new Error('O destino do resultado da agenda é inválido. Os dados foram preservados.')
}

export type ScheduleStatus = 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'missed'
export interface ScheduleRun {
  delivery?: ScheduleDelivery
  startedAt: number
  scheduledAt: number
  finishedAt?: number
  status: Exclude<ScheduleStatus, 'ready'>
  result?: string
  conversationId?: string
}
export interface StudioSchedule {
  resultDestination?: ScheduleDestination
  id: string
  name: string
  goal: string
  agent: StudioAgentProfile
  timezone: string
  rule: ScheduleRule
  enabled: boolean
  nextAt: number | null
  status: ScheduleStatus
  lastAt?: number
  lastSlot?: string
  conversationId?: string
  result?: string
  cancelRequested?: boolean
  history?: ScheduleRun[]
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timezone: string) {
  if (typeof timezone !== 'string' || timezone.length > 100) throw new Error('Informe um fuso horário válido.')
  let value = formatters.get(timezone)
  if (!value) {
    try { value = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }
    catch { throw new Error('Informe um fuso horário válido, como America/Sao_Paulo.') }
    if (formatters.size > 100) formatters.clear()
    formatters.set(timezone, value)
  }
  return value
}
export function localSlot(epoch: number, timezone: string): string {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(epoch).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
function validLocal(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  const epoch = Date.parse(value + 'Z')
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 16) === value
}
export function scheduleRule(value: unknown): ScheduleRule {
  if (!isRecord(value)) throw new Error('Defina a frequência da tarefa.')
  if (value.kind === 'once' && validLocal(value.local)) return { kind: 'once', local: value.local }
  if (value.kind === 'weekly' && typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) && Array.isArray(value.days) && value.days.length > 0 && value.days.length <= 7 && value.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) return { kind: 'weekly', time: value.time, days: [...new Set(value.days as number[])].sort() }
  const validTime = typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
  if (value.kind === 'daily' && validTime) return { kind: 'daily', time: value.time as string }
  if (value.kind === 'monthly' && validTime && Number.isInteger(value.day) && Number(value.day) >= 1 && Number(value.day) <= 31) return { kind: 'monthly', time: value.time as string, day: Number(value.day) }
  if (value.kind === 'interval' && typeof value.minutes === 'number' && Number.isInteger(value.minutes) && value.minutes >= 1 && value.minutes <= 525_600 && typeof value.startAt === 'number' && Number.isFinite(value.startAt) && value.startAt > 0 && value.startAt <= 8_000_000_000_000_000) return { kind: 'interval', minutes: value.minutes, startAt: value.startAt }
  throw new Error('Confira os dias, a data, o horário ou o intervalo de minutos.')
}

const dayOffsets = new Map<string, number[]>()

/** Resolve wall-clock minutes against real zone offsets on either side of a transition. */
export function localEpochs(slot: string, timezone: string): number[] {
  formatter(timezone)
  const date = slot.slice(0, 10)
  const key = `${timezone}/${date}`
  let offsets = dayOffsets.get(key)
  if (!offsets) {
    const noon = Date.parse(date + 'T12:00:00Z')
    const values = new Set<number>()
    for (let hours = -36; hours <= 36; hours += 6) {
      const sample = noon + hours * 3_600_000
      values.add(Date.parse(localSlot(sample, timezone) + 'Z') - sample)
    }
    offsets = [...values]
    if (dayOffsets.size > 4000) dayOffsets.clear()
    dayOffsets.set(key, offsets)
  }
  const naive = Date.parse(slot + 'Z')
  return offsets.map(offset => naive - offset).filter(epoch => localSlot(epoch, timezone) === slot).sort((a, b) => a - b)
}

/** Strictly after `after`. Missing DST times are skipped, consumed wall-clock minutes never repeat. */
export function nextOccurrence(rule: ScheduleRule, timezone: string, after: number, lastSlot?: string): number | null {
  formatter(timezone)
  if (rule.kind === 'interval') {
    const step = rule.minutes * 60_000
    return rule.startAt > after ? rule.startAt : rule.startAt + (Math.floor((after - rule.startAt) / step) + 1) * step
  }
  if (rule.kind === 'once') {
    if (rule.local === lastSlot) return null
    return localEpochs(rule.local, timezone).find(epoch => epoch > after) ?? null
  }
  const firstDay = Date.parse(localSlot(after, timezone).slice(0, 10) + 'T12:00:00Z')
  const horizon = rule.kind === 'monthly' ? 66 : 8
  for (let day = 0; day <= horizon; day++) {
    const date = new Date(firstDay + day * 86_400_000)
    if (rule.kind === 'weekly' && !rule.days.includes(date.getUTCDay())) continue
    if (rule.kind === 'monthly' && rule.day !== date.getUTCDate()) continue
    const slot = `${date.toISOString().slice(0, 10)}T${rule.time}`
    if (slot === lastSlot) continue
    const epoch = localEpochs(slot, timezone).find(epoch => epoch > after)
    if (epoch !== undefined) return epoch
  }
  return null
}

export function finishScheduleRun(item: StudioSchedule, status: ScheduleRun['status'], result: string, now: number, targetConversationId?: string | null): StudioSchedule {
  const history = item.history ?? []
  const previous = history.at(-1)
  const run: ScheduleRun = {
    startedAt: previous?.status === 'running' ? previous.startedAt : now,
    scheduledAt: previous?.status === 'running' ? previous.scheduledAt : item.nextAt ?? item.lastAt ?? now,
    finishedAt: now, status, result: result.slice(0, 12_000),
    ...(item.resultDestination && item.resultDestination !== 'history' && ['completed', 'failed', 'cancelled'].includes(status) ? { delivery: { mode: item.resultDestination, state: 'pending', ...(targetConversationId ? { targetConversationId } : {}) } as ScheduleDelivery } : {}),
    ...(item.conversationId && status !== 'missed' ? { conversationId: item.conversationId } : {}),
  }
  return { ...item, status, result: run.result, history: [...(previous?.status === 'running' ? history.slice(0, -1) : history), run] }
}

function readDelivery(value: unknown): ScheduleDelivery | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !['chat', 'popup', 'txt'].includes(String(value.mode)) || !['pending', 'done', 'failed'].includes(String(value.state))) throw new Error('A entrega da agenda contém dados inválidos. Os dados foram preservados.')
  return { mode: value.mode as ScheduleDelivery['mode'], state: value.state as ScheduleDelivery['state'],
    ...(typeof value.targetConversationId === 'string' ? { targetConversationId: value.targetConversationId.slice(0, 100) } : {}),
    ...(typeof value.path === 'string' ? { path: value.path.slice(0, 4000) } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 2000) } : {}),
  }
}

function readHistory(value: unknown): ScheduleRun[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('O histórico da agenda contém dados inválidos. Os dados foram preservados.')
  return value.map(row => {
    if (!isRecord(row) || typeof row.startedAt !== 'number' || !Number.isFinite(row.startedAt) || typeof row.scheduledAt !== 'number' || !Number.isFinite(row.scheduledAt) || !['running', 'completed', 'failed', 'cancelled', 'interrupted', 'missed'].includes(String(row.status)) || (row.finishedAt !== undefined && (typeof row.finishedAt !== 'number' || !Number.isFinite(row.finishedAt)))) throw new Error('O histórico da agenda contém dados inválidos. Os dados foram preservados.')
    return { delivery: readDelivery(row.delivery), startedAt: row.startedAt, scheduledAt: row.scheduledAt, status: row.status as ScheduleRun['status'],
      ...(typeof row.finishedAt === 'number' ? { finishedAt: row.finishedAt } : {}),
      ...(typeof row.result === 'string' ? { result: row.result.slice(0, 12_000) } : {}),
      ...(typeof row.conversationId === 'string' ? { conversationId: row.conversationId.slice(0, 80) } : {}),
    }
  })
}

export function scheduleInput(name: string, goal: string, agent: StudioAgentProfile, timezone: string, rawRule: unknown) {
  const profile = { ...agentProfileInput(agent.name, agent.instructions, agent.model), id: agent.id }
  if (!profile.model) throw new Error('Selecione um modelo para o agente antes de agendar.')
  if (!name.trim() || name.trim().length > 100 || !goal.trim() || goal.trim().length > 16_000 || goal.includes('\0')) throw new Error('Informe um nome de até 100 caracteres e uma tarefa de até 16.000 caracteres.')
  formatter(timezone)
  return { name: name.trim(), goal: goal.trim(), agent: profile, timezone, rule: scheduleRule(rawRule) }
}

/** Invalid saved agendas fail closed; never silently replace them with an empty list. */
export function readSchedules(raw: string | null): StudioSchedule[] {
  if (raw === null) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error('Não foi possível ler a agenda salva. Os dados foram preservados.') }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > 200) throw new Error('Não foi possível ler a agenda salva. Os dados foram preservados.')
  const ids = new Set<string>()
  return parsed.items.map((row): StudioSchedule => {
    if (!isRecord(row) || typeof row.id !== 'string' || !/^[\w-]{1,80}$/.test(row.id) || ids.has(row.id) || typeof row.name !== 'string' || typeof row.goal !== 'string' || !isRecord(row.agent) || typeof row.agent.id !== 'string' || typeof row.agent.name !== 'string' || typeof row.agent.instructions !== 'string' || typeof row.agent.model !== 'string' || typeof row.timezone !== 'string' || typeof row.enabled !== 'boolean' || !(row.nextAt === null || typeof row.nextAt === 'number' && Number.isFinite(row.nextAt) && row.nextAt > 0 && row.nextAt < 8_000_000_000_000_000) || !['ready', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'missed'].includes(String(row.status))) throw new Error('A agenda contém dados inválidos. Os dados foram preservados.')
    ids.add(row.id)
    const input = scheduleInput(row.name, row.goal, row.agent as unknown as StudioAgentProfile, row.timezone, row.rule)
    return { ...input, resultDestination: scheduleDestination(row.resultDestination), id: row.id, enabled: row.enabled, nextAt: row.nextAt as number | null, status: row.status as ScheduleStatus,
      ...(typeof row.lastAt === 'number' && Number.isFinite(row.lastAt) ? { lastAt: row.lastAt } : {}),
      ...(typeof row.lastSlot === 'string' && validLocal(row.lastSlot) ? { lastSlot: row.lastSlot } : {}),
      ...(typeof row.conversationId === 'string' ? { conversationId: row.conversationId.slice(0, 80) } : {}),
      ...(typeof row.result === 'string' ? { result: row.result.slice(0, 12_000) } : {}),
      ...(row.cancelRequested === true ? { cancelRequested: true } : {}),
      history: readHistory(row.history),
    }
  })
}


/** Future occurrences for calendar display, bounded even for one-minute timers. */
export function calendarOccurrences(item: StudioSchedule, start: number, end: number, now: number, limit = 48): { times: number[]; more: boolean } {
  const times: number[] = []
  if (!item.enabled || item.nextAt === null || end <= start || limit < 1) return { times, more: false }
  let after = Math.max(start, item.nextAt, now) - 1
  for (let index = 0; index <= Math.min(limit, 96); index++) {
    const at = nextOccurrence(item.rule, item.timezone, after, item.lastSlot)
    if (at === null || at >= end) return { times, more: false }
    if (index === Math.min(limit, 96)) return { times, more: true }
    times.push(at)
    after = at
  }
  return { times, more: false }
}
