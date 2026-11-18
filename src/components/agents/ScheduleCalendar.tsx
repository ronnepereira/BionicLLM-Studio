import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Cloud, RefreshCw } from 'lucide-react'
import { localEpochs, localSlot, calendarOccurrences, type StudioSchedule } from '../../lib/schedules'
import { googleAvailable, googleStatus, readGoogle, type GoogleItem } from '../../api/studio-google'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUiText } from '../../lib/ui-text'
import { Modal } from '../ui/Modal'

const button = 'rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50'
const DAY = 86_400_000
type Period = 'day' | 'week' | 'month'

function dayStart(date: string, zone: string): number | null {
  for (let minute = 0; minute < 1440; minute++) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    const epoch = localEpochs(`${date}T${time}`, zone)[0]
    if (epoch !== undefined) return epoch
  }
  return null
}

function GoogleEvents({ start, end, onEvents }: { start: number; end: number; onEvents: (events: GoogleItem[], replace: boolean) => void }) {
  const text = useUiText()
  const [connected, setConnected] = useState(false)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<string | undefined>()
  const [nextPage, setNextPage] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!googleAvailable()) return
    let alive = true
    const refresh = () => { void googleStatus().then(status => {
      if (alive) setConnected(status.services.some(service => service.service === 'calendar' && service.enabled))
    }).catch(() => { if (alive) setConnected(false) }) }
    refresh()
    window.addEventListener('bionic-google-changed', refresh)
    return () => { alive = false; window.removeEventListener('bionic-google-changed', refresh) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      if (!connected) { onEvents([], true); return }
      setBusy(true); setError('')
      try {
        const result = await readGoogle({ action: 'calendar_list', query: '', start: new Date(start).toISOString(), end: new Date(end).toISOString(), page_token: page }, controller.signal)
        if (!controller.signal.aborted) { onEvents(result.items ?? [], !page); setNextPage(result.nextPageToken) }
      } catch (error) { if (!controller.signal.aborted) setError(String(error)) }
      finally { if (!controller.signal.aborted) setBusy(false) }
    })
    return () => controller.abort()
  }, [connected, start, end, page, revision, onEvents])
  if (!connected) return null
  return <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
    <Cloud size={14} /><span>Google Agenda</span>
    <button className={button} disabled={busy} onClick={() => { setPage(undefined); setRevision(value => value + 1) }} aria-label={text('Refresh Google Calendar')}><RefreshCw size={13} /></button>
    {busy && <span>{text('Loading events…')}</span>}
    {nextPage && <button className={button} disabled={busy} onClick={() => setPage(nextPage)}>{text('Load more events')}</button>}
    {error && <span role="alert" className="text-red-500">{error}</span>}
  </div>
}

export function ScheduleCalendar({ items, onEdit }: { items: StudioSchedule[]; onEdit: (item: StudioSchedule) => void }) {
  const text = useUiText()
  const language = useSettingsStore(s => s.settings.language)
  const locale = language === 'en' ? 'en-US' : 'pt-BR'
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [anchor, setAnchor] = useState(() => localSlot(Date.now(), zone).slice(0, 10))
  const [period, setPeriod] = useState<Period>('month')
  const [events, setEvents] = useState<GoogleItem[]>([])
  const [event, setEvent] = useState<GoogleItem | null>(null)
  const dates = useMemo(() => {
    const date = new Date(`${anchor}T12:00:00Z`)
    if (period === 'month') date.setUTCDate(1)
    if (period !== 'day') date.setUTCDate(date.getUTCDate() - date.getUTCDay())
    const count = period === 'day' ? 1 : period === 'week' ? 7 : 42
    return Array.from({ length: count }, (_, index) => {
      const dateKey = new Date(date.getTime() + index * DAY).toISOString().slice(0, 10)
      const nextKey = new Date(date.getTime() + (index + 1) * DAY).toISOString().slice(0, 10)
      return { date: dateKey, start: dayStart(dateKey, zone), end: dayStart(nextKey, zone) }
    })
  }, [anchor, period, zone])
  const start = dates.find(day => day.start !== null)?.start ?? now
  const end = [...dates].reverse().find(day => day.end !== null)?.end ?? start + DAY
  const mergeEvents = useCallback((incoming: GoogleItem[], replace: boolean) => {
    setEvents(previous => [...new Map([...(replace ? [] : previous), ...incoming].map(item => [item.id, item])).values()])
  }, [])
  const move = (direction: number) => {
    const date = new Date(`${anchor}T12:00:00Z`)
    if (period === 'month') { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + direction) }
    else date.setUTCDate(date.getUTCDate() + direction * (period === 'week' ? 7 : 1))
    setAnchor(date.toISOString().slice(0, 10))
  }
  const time = (epoch: number) => new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(epoch)
  return <section className="space-y-3" aria-label={text('Schedule calendar')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} onClick={() => move(-1)} aria-label={text('Previous period')}><ChevronLeft size={15} /></button>
        <input type="date" aria-label={text('Calendar date')} value={anchor} onChange={event => { if (event.target.value) setAnchor(event.target.value) }} className={`${button} bg-transparent`} />
        <button className={button} onClick={() => move(1)} aria-label={text('Next period')}><ChevronRight size={15} /></button>
        <button className={button} onClick={() => setAnchor(localSlot(Date.now(), zone).slice(0, 10))}>{text('Today')}</button>
      </div>
      <div className="flex gap-1" role="group" aria-label={text('Calendar view')}>
        {(['day', 'week', 'month'] as const).map(value => <button key={value} className={`${button} aria-pressed:bg-blue-500/15 aria-pressed:border-blue-500`} aria-pressed={period === value} onClick={() => setPeriod(value)}>{text(({ day: 'Day', week: 'Week', month: 'Month' })[value])}</button>)}
      </div>
    </div>
    <p className="text-xs text-gray-500">{text('Calendar time zone')} · {zone}</p>
    <GoogleEvents key={`${start}/${end}`} start={start} end={end} onEvents={mergeEvents} />
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
      <div className={`grid gap-px bg-gray-200 dark:bg-white/10 ${period === 'day' ? 'grid-cols-1' : 'min-w-[700px] grid-cols-7'}`}>
        {dates.map(day => {
          const today = day.date === localSlot(now, zone).slice(0, 10)
          return <div key={day.date} className={`min-h-28 min-w-0 bg-white dark:bg-[#1e1e1e] p-2 ${today ? 'ring-1 ring-inset ring-blue-500' : ''}`}>
            <div className="mb-2 text-xs font-medium">{new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day.date}T12:00Z`))}</div>
            <div className="space-y-1">
              {items.flatMap(item => {
                if (day.start === null || day.end === null) return []
                const occurrences = calendarOccurrences(item, day.start, day.end, now, period === 'day' ? 48 : period === 'week' ? 8 : 3)
                return occurrences.times.map((at, index) => ({ item, at, more: occurrences.more && index === occurrences.times.length - 1 }))
              }).sort((a, b) => a.at - b.at).map(({ item, at, more }) => <button key={`${item.id}/${at}`} onClick={() => onEdit(item)} disabled={item.status === 'running'} className="block w-full rounded-md border border-blue-500/25 bg-blue-500/10 px-2 py-1.5 text-left text-xs hover:bg-blue-500/20 disabled:opacity-50">
                <span className="block break-words font-medium">{item.name}</span><span>{time(at)}{item.rule.kind === 'interval' ? ` · ${item.rule.minutes} min` : ''}</span>
                {more && <span className="block text-gray-500">{text('More occurrences on this day')}</span>}
              </button>)}
              {events.filter(item => {
                if (item.status === 'cancelled') return false
                if (item.start?.date) return item.start.date <= day.date && (item.end?.date ?? item.start.date + 'x') > day.date
                const start = Date.parse(item.start?.dateTime ?? '')
                const end = Date.parse(item.end?.dateTime ?? '') || start + 60_000
                return day.start !== null && day.end !== null && start < day.end && end > day.start
              }).map(item => <button key={item.id} onClick={() => setEvent(item)} className="block w-full rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1.5 text-left text-xs hover:bg-emerald-500/20"><span className="block break-words font-medium">{item.summary || text('Untitled event')}</span><span>Google · {item.start?.date ? text('All day') : time(Date.parse(item.start?.dateTime ?? ''))}</span></button>)}
            </div>
          </div>
        })}
      </div>
    </div>
    <Modal open={event !== null} onClose={() => setEvent(null)} title={event?.summary || text('Google Calendar event')}>
      <div className="space-y-3 text-sm"><p>{event?.start?.dateTime ? new Date(event.start.dateTime).toLocaleString(locale) : event?.start?.date}</p><p>{event?.location}</p><p className="whitespace-pre-wrap break-words">{event?.description}</p><p className="text-xs text-gray-500">{text('Google events are displayed for reference. Agent tasks are managed in the internal scheduler.')}</p></div>
    </Modal>
  </section>
}
