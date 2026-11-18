import { MarkdownRenderer } from '../chat/MarkdownRenderer'
import { ScheduleResultDialog } from './ScheduleResultDialog'
import { SCHEDULE_DESTINATIONS, exportScheduleTxt, scheduleRunText, updateScheduleDelivery } from '../../lib/schedule-results'
import { useRef, useState } from 'react'
import { CalendarClock, Plus, Pause, Play, Square, Trash2, MessageSquare, Pencil } from 'lucide-react'
import { useUiText } from '../../lib/ui-text'
import { useScheduleStore } from '../../stores/scheduleStore'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ScheduleCalendar } from './ScheduleCalendar'
import { localSlot, type StudioSchedule, type ScheduleRule, type ScheduleStatus, type ScheduleDestination, type ScheduleRun } from '../../lib/schedules'

const field = 'w-full rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm'
const button = 'studio-action inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50'
const statuses: Record<ScheduleStatus, string> = { ready: 'Scheduled', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', missed: 'Missed occurrence' }
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SchedulesView() {
  const text = useUiText()
  const { items, error: storageError, add, update, toggle, cancel, remove } = useScheduleStore()
  const profiles = useAgentProfileStore(s => s.profiles)
  const language = useSettingsStore(s => s.settings.language)
  const setView = useUIStore(s => s.setView)
  const [editing, setEditing] = useState(false)
  const [destination, setDestination] = useState<ScheduleDestination>('history')
  const [preview, setPreview] = useState<{ item: StudioSchedule; run: ScheduleRun } | null>(null)
  const [notice, setNotice] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [model, setModel] = useState(() => useModelStore.getState().activeModel ?? '')
  const models = useModelStore(state => state.models)
  const [monthDay, setMonthDay] = useState(1)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [agentId, setAgentId] = useState('')
  const [kind, setKind] = useState<ScheduleRule['kind']>('once')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [local, setLocal] = useState(() => localSlot(Date.now() + 3_600_000, Intl.DateTimeFormat().resolvedOptions().timeZone))
  const [time, setTime] = useState('09:00')
  const [days, setDays] = useState([1, 2, 3, 4, 5])
  const [minutes, setMinutes] = useState(60)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const act = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await work(); setError('') } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const edit = (item: StudioSchedule) => {
    setDestination(item.resultDestination ?? 'history'); setEditingId(item.id); setEditing(true); setName(item.name); setGoal(item.goal)
    setAgentId(item.agent.id.startsWith('agenda-') ? '' : item.agent.id)
    setModel(item.agent.model); setTimezone(item.timezone); setKind(item.rule.kind)
    if (item.rule.kind === 'once') setLocal(item.rule.local)
    if ('time' in item.rule) setTime(item.rule.time)
    if (item.rule.kind === 'weekly') setDays(item.rule.days)
    if (item.rule.kind === 'monthly') setMonthDay(item.rule.day)
    if (item.rule.kind === 'interval') setMinutes(item.rule.minutes)
    setError('')
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const newSchedule = () => {
    setEditingId(null); setEditing(true); setName(''); setGoal(''); setAgentId('')
    setKind('once'); setLocal(localSlot(Date.now() + 3_600_000, timezone))
    setModel(useModelStore.getState().activeModel ?? ''); setDestination('history'); setError('')
  }
  const save = () => act(async () => {
    const previous = items.find(item => item.id === editingId)
    const profile = profiles.find(profile => profile.id === agentId) ?? (previous?.agent.id === agentId ? previous.agent : undefined)
    const selected = model || profile?.model || useModelStore.getState().activeModel
    if (!selected) throw new Error(text('Choose a text model before scheduling.'))
    const found = models.find(entry => entry.name === selected)
    if (found?.type === 'image' || found?.type === 'video') throw new Error(text('Choose a text model before scheduling.'))
    const agent = profile ? { ...profile, model: selected } : {
      id: previous?.agent.id.startsWith('agenda-') ? previous.agent.id : `agenda-${crypto.randomUUID()}`,
      name: name.trim().slice(0, 80), model: selected,
      instructions: 'Execute a tarefa descrita na mensagem deste agendamento. Use as ferramentas disponíveis e relate o resultado ou a falha encontrada.',
    }
    let rule: ScheduleRule
    if (kind === 'once') rule = { kind, local }
    else if (kind === 'weekly') rule = { kind, time, days }
    else if (kind === 'daily') rule = { kind, time }
    else if (kind === 'monthly') rule = { kind, time, day: monthDay }
    else rule = previous?.rule.kind === 'interval' && previous.rule.minutes === minutes ? previous.rule : { kind, minutes, startAt: Date.now() + minutes * 60_000 }
    if (editingId) await update(editingId, name, goal, agent, timezone, rule, destination)
    else await add(name, goal, agent, timezone, rule, destination)
    setEditing(false); setEditingId(null); setName(''); setGoal('')
  })
  const openConversation = (id: string) => {
    if (!useChatStore.getState().conversations.some(conversation => conversation.id === id)) { setError(text('This conversation has been removed.')); return }
    useChatStore.getState().setActiveConversation(id); setView('chat')
  }
  const date = (epoch: number, zone: string) => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'pt-BR', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(epoch)

  const saveTxt = (item: StudioSchedule, run: ScheduleRun) => act(async () => {
    const saved = await exportScheduleTxt(item, run)
    if (saved.status === 'error') throw new Error(saved.error)
    setNotice(saved.status === 'saved' ? 'TXT salvo: ' + (saved.path || '') : saved.status === 'downloaded' ? 'Download do TXT iniciado.' : saved.status === 'shared' ? 'TXT compartilhado.' : '')
  })
  const runActions = (item: StudioSchedule, run: ScheduleRun) => <div className="flex flex-wrap gap-2">
    <button className={button} onClick={() => setPreview({ item, run })}>Ver em pop-up</button>
    <button disabled={busy} className={button} onClick={() => { void saveTxt(item, run) }}>Salvar TXT</button>
    {run.delivery?.state === 'failed' && <button disabled={busy} className={button} onClick={() => { void act(() => updateScheduleDelivery(item.id, run.scheduledAt, current => ({ ...current, delivery: { ...current.delivery!, state: 'pending', error: undefined } }))) }}>Tentar entrega novamente</button>}
  </div>
  const deliveryInfo = (run: ScheduleRun) => run.delivery ? <div className="space-y-1 text-xs">
    {run.delivery.state === 'pending' && <p className="text-amber-500">Entrega adicional aguardando exibição ou conclusão do chat.</p>}
    {run.delivery.state === 'done' && <p className="text-emerald-600 dark:text-emerald-400">{run.delivery.mode === 'txt' ? (run.delivery.path ? 'TXT salvo automaticamente.' : 'Download do TXT iniciado.') : 'Resultado exibido.'}</p>}
    {run.delivery.path && <p className="break-all text-gray-500">{run.delivery.path}</p>}
    {run.delivery.error && <p role="alert" className="text-red-500">{run.delivery.error} A execução não será repetida. O resultado está no histórico.</p>}
  </div> : null
  return <div className="studio-form h-full overflow-auto text-gray-800 dark:text-gray-200"><div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">{text('Task scheduler')}</h1><p className="mt-1 text-sm text-gray-500">{text('Create a task and choose when it runs. The system prepares its agent automatically.')}</p></div><button className={button} onClick={newSchedule}><Plus size={15} />{text('New schedule')}</button></div>
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm space-y-2"><p>{text('Keep the app open and the computer awake. Missed occurrences are skipped; interrupted runs are paused for review and are never retried automatically.')}</p><p>{text('A delay of up to 90 seconds is accepted. Only one scheduled agent runs at a time; longer delays are skipped without replay.')}</p><p className="text-gray-500">{text('Schedules keep a copy of the agent instructions and model. Active skills and tool permissions are checked at execution time. Actions that need approval wait for your confirmation in the conversation.')}</p></div>
    {notice && <p role="status" className="break-all text-sm text-blue-500">{notice}</p>}
    {preview && <ScheduleResultDialog item={preview.item} run={preview.run} onClose={() => setPreview(null)} />}
    {(error || storageError) && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-600 dark:text-red-400">{error || storageError}</p>}
    {editing && <form ref={formRef} className="rounded-xl border border-gray-200 dark:border-white/10 p-4 space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">{text('Task name')}<input required maxLength={100} className={`${field} mt-1`} value={name} onChange={e => setName(e.target.value)} /></label><div className="text-sm"><label htmlFor="schedule-agent">{text('Agent')}</label><select id="schedule-agent" className={`${field} mt-1`} value={agentId} onChange={e => { setAgentId(e.target.value); const selected = profiles.find(profile => profile.id === e.target.value); if (selected?.model) setModel(selected.model) }}><option value="">{text('Automatic agent')}</option>{editingId && agentId && !profiles.some(profile => profile.id === agentId) && <option value={agentId}>{items.find(item => item.id === editingId)?.agent.name}</option>}{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></div></div>
      <p className="text-xs text-gray-500">{text('With the automatic agent, enter the task instructions only once below. Existing agents can optionally provide additional guidelines.')}</p>
      <label className="block text-sm">{text('Text model')}<select required className={`${field} mt-1`} value={model} onChange={event => setModel(event.target.value)}><option value="">{text('Choose a text model')}</option>{models.filter(entry => entry.type !== 'image' && entry.type !== 'video' && entry.provider !== 'lu-cloud').map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label>
      <label className="block text-sm">{text('Task instructions')}<textarea required maxLength={16_000} className={`${field} mt-1 min-h-28`} value={goal} onChange={e => setGoal(e.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2"><div className="text-sm"><label htmlFor="schedule-frequency">{text('Frequency')}</label><select id="schedule-frequency" className={`${field} mt-1`} value={kind} onChange={e => setKind(e.target.value as ScheduleRule['kind'])}><option value="once">{text('Once')}</option><option value="daily">{text('Daily')}</option><option value="monthly">{text('Monthly')}</option><option value="weekly">{text('Selected weekdays')}</option><option value="interval">{text('Interval in minutes')}</option></select></div><div className="text-sm"><label htmlFor="schedule-timezone">{text('Time zone')}</label><input id="schedule-timezone" required list="schedule-timezones" className={`${field} mt-1`} value={timezone} onChange={e => setTimezone(e.target.value)} /><datalist id="schedule-timezones">{['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha', 'UTC', 'Europe/Lisbon', 'America/New_York'].map(zone => <option key={zone} value={zone} />)}</datalist></div></div>
      {kind === 'once' && <label className="block text-sm">{text('Date and time in the selected time zone')}<input required type="datetime-local" className={`${field} mt-1`} value={local} onChange={e => setLocal(e.target.value)} /></label>}
      {(kind === 'daily' || kind === 'monthly') && <label className="block text-sm">{text('Time in the selected time zone')}<input required type="time" className={`${field} mt-1`} value={time} onChange={event => setTime(event.target.value)} /></label>}
      {kind === 'monthly' && <label className="block text-sm">{text('Day of the month')}<input required type="number" min={1} max={31} className={`${field} mt-1`} value={monthDay} onChange={event => setMonthDay(Number(event.target.value))} /><span className="mt-1 block text-xs text-gray-500">{text('Months without this day are skipped.')}</span></label>}
      {kind === 'weekly' && <><label className="block text-sm">{text('Time in the selected time zone')}<input required type="time" className={`${field} mt-1`} value={time} onChange={e => setTime(e.target.value)} /></label><fieldset><legend className="text-sm mb-2">{text('Days of the week')}</legend><div className="flex flex-wrap gap-3">{weekdays.map((day, index) => <label key={day} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={days.includes(index)} onChange={e => setDays(previous => e.target.checked ? [...previous, index] : previous.filter(day => day !== index))} />{text(day)}</label>)}</div></fieldset></>}
      {kind === 'interval' && <label className="block text-sm">{text('Repeat every (minutes)')}<input required type="number" min={1} max={525600} className={`${field} mt-1`} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /><span className="block mt-1 text-xs text-gray-500">{text('The first run starts after this interval. Intervals use elapsed time, including daylight saving changes.')}</span></label>}
      {kind !== 'interval' && <p className="text-xs text-gray-500">{text('During daylight saving changes, nonexistent times are skipped and repeated times run once.')}</p>}
      <div className="space-y-2"><label htmlFor="schedule-result-destination" className="text-sm">Onde exibir o resultado</label><select id="schedule-result-destination" className={field} value={destination} onChange={event => setDestination(event.target.value as ScheduleDestination)}>{SCHEDULE_DESTINATIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        <p className="text-xs text-gray-500">A conversa e o histórico da Agenda são sempre preservados, independentemente desta opção.</p>
        {destination === 'chat' && <p className="text-xs text-gray-500">Usa o chat selecionado ao concluir. Se ele estiver respondendo, aguarda o término sem trocar a tela nem enviar outro pedido ao modelo. Sem um chat selecionado, o resultado permanece no histórico.</p>}
        {destination === 'popup' && <p className="text-xs text-gray-500">Abre o resultado no aplicativo. As demais tarefas continuam executando enquanto a janela estiver aberta.</p>}
        {destination === 'txt' && <p className="text-xs text-gray-500">No desktop, salva automaticamente em Documentos/BionicLLM Studio/Agenda. No navegador, inicia um download. Você também pode usar Salvar TXT no resultado para escolher outro local.</p>}
      </div>
      <div className="flex gap-2"><button type="submit" disabled={busy} className={button}>{text('Save schedule')}</button><button type="button" className={button} onClick={() => setEditing(false)}>{text('Cancel')}</button></div>
    </form>}
    <ScheduleCalendar items={items} onEdit={edit} />
    {!items.length && !editing && <div className="rounded-xl border border-dashed border-gray-300 dark:border-white/15 p-8 text-center space-y-2"><CalendarClock className="mx-auto text-gray-500" size={28} /><p className="text-sm text-gray-500">{text('No scheduled tasks yet.')}</p></div>}
    <div className="space-y-4">{items.map(item => <article key={item.id} className="rounded-xl border border-gray-200 dark:border-white/10 p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold break-words">{item.name}</h2><p className="text-xs text-gray-500 break-all">{item.agent.name} · {item.timezone}</p></div><span className="text-xs rounded-full border border-gray-300 dark:border-white/15 px-3 py-1 self-start">{text(statuses[item.status])}{item.rule.kind !== 'once' || item.status === 'ready' ? ` · ${item.enabled ? text('Active schedule') : text('Paused schedule')}` : ''}</span></div>
      <p className="text-sm text-gray-500 whitespace-pre-wrap break-words line-clamp-3">{item.goal}</p>
      <p className="text-xs text-gray-500">{item.rule.kind === 'daily' ? `${text('Daily')} · ${item.rule.time}` : item.rule.kind === 'monthly' ? `${text('Monthly')} · ${item.rule.day} · ${item.rule.time}` : item.rule.kind === 'once' ? `${text('Once')} · ${date(Date.parse(item.rule.local + 'Z'), 'UTC')}` : item.rule.kind === 'weekly' ? `${item.rule.days.map(day => text(weekdays[day])).join(', ')} · ${item.rule.time}` : `${text('Repeat every (minutes)')}: ${item.rule.minutes}`}</p>
      <p className="text-sm">{text('Next occurrence')}: {item.enabled && item.nextAt ? date(item.nextAt, item.timezone) : '—'}</p>
      <p className="text-xs text-blue-500">Destino: {SCHEDULE_DESTINATIONS.find(option => option.id === (item.resultDestination ?? 'history'))?.label} · histórico preservado</p>
      {item.lastAt && <p className="text-xs text-gray-500">{text('Last attempt')}: {date(item.lastAt, item.timezone)}</p>}
      {item.result && <details><summary className="cursor-pointer text-sm font-medium">Último resultado</summary><div className="my-3 min-w-0 max-h-96 overflow-auto rounded-lg bg-gray-50 p-4 text-base leading-relaxed dark:bg-white/[0.02]"><MarkdownRenderer content={item.history?.length ? scheduleRunText(item, item.history.at(-1)!) : item.result} /></div>{item.history?.length ? <>{deliveryInfo(item.history.at(-1)!)}{runActions(item, item.history.at(-1)!)}</> : null}</details>}
      {!!item.history?.length && <details className="text-sm"><summary className="cursor-pointer font-medium">{text('Execution history')} · {item.history.length}</summary><ol className="mt-3 space-y-3">{[...item.history].reverse().map((run, index) => <li key={`${run.startedAt}-${index}`} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2"><div className="flex flex-wrap justify-between gap-2 text-xs"><time>{date(run.startedAt, item.timezone)}</time><span>{text(statuses[run.status])}</span></div>{run.finishedAt && <p className="text-xs text-gray-500">{text('Finished')} · {date(run.finishedAt, item.timezone)}</p>}{run.result && <div className="min-w-0 max-h-96 overflow-auto text-base leading-relaxed"><MarkdownRenderer content={scheduleRunText(item, run)} /></div>}{deliveryInfo(run)}{run.status !== 'running' && runActions(item, run)}{run.conversationId && <button className={button} onClick={() => openConversation(run.conversationId!)}><MessageSquare size={13} />{text('Open conversation')}</button>}</li>)}</ol></details>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy || item.status === 'running'} onClick={() => edit(item)}><Pencil size={14} />{text('Edit')}</button>
        <button disabled={busy || item.status === 'running' && !item.enabled} className={button} onClick={() => { void act(() => toggle(item.id)) }}>{item.enabled ? <Pause size={14} /> : <Play size={14} />}{item.enabled ? text('Pause schedule') : text('Resume schedule')}</button>
        {item.status === 'running' && <button disabled={busy || item.cancelRequested} className={button} onClick={() => { void act(() => cancel(item.id)) }}><Square size={14} />{item.cancelRequested ? text('Cancelling') : text('Cancel run and pause')}</button>}
        {item.conversationId && <button className={button} onClick={() => {
          if (!useChatStore.getState().conversations.some(c => c.id === item.conversationId)) { setError(text('This conversation has been removed.')); return }
          useChatStore.getState().setActiveConversation(item.conversationId!); setView('chat')
        }}><MessageSquare size={14} />{text('Open conversation')}</button>}
        {item.status !== 'running' && <button disabled={busy} className={button} onClick={() => removing === item.id ? void act(async () => { await remove(item.id); setRemoving(null) }) : setRemoving(item.id)} aria-label={text('Remove {v0}', { v0: item.name })}><Trash2 size={14} />{removing === item.id ? text('Confirm removal') : text('Remove')}</button>}
        {removing === item.id && <button className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </div>
    </article>)}</div>
  </div></div>
}
