import { backendCall, isTauri } from '../../api/backend'
import { useEffect, useState } from 'react'
import { ScheduleResultDialog } from './ScheduleResultDialog'
import type { StudioSchedule, ScheduleRun } from '../../lib/schedules'
import { deliverScheduleResults } from '../../lib/schedule-results'
import { useScheduleStore } from '../../stores/scheduleStore'
import { useGenerationStore } from '../../stores/generationStore'

export function ScheduleResultsHost() {
  const [popup, setPopup] = useState<{ item: StudioSchedule; run: ScheduleRun; close: () => void } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const busy = { popup: false, background: false }
    const show = (item: StudioSchedule, run: ScheduleRun) => new Promise<void>(resolve => {
      const close = () => { controller.signal.removeEventListener('abort', close); setPopup(null); resolve() }
      controller.signal.addEventListener('abort', close, { once: true })
      setPopup({ item, run, close })
      if (isTauri()) void backendCall('show_window').catch(() => {})
    })
    const process = async (channel: 'popup' | 'background') => {
      if (busy[channel] || controller.signal.aborted) return
      busy[channel] = true
      try { await deliverScheduleResults(show, controller.signal, channel) }
      catch (error) { useScheduleStore.setState({ error: error instanceof Error ? error.message : String(error) }) }
      finally { busy[channel] = false }
    }
    const tick = () => { void process('background'); void process('popup') }
    const timer = window.setInterval(tick, 1000)
    const schedule = useScheduleStore.subscribe(tick)
    const generation = useGenerationStore.subscribe(tick)
    tick()
    return () => { controller.abort(); clearInterval(timer); schedule(); generation() }
  }, [])
  return popup ? <ScheduleResultDialog key={popup.item.id + popup.run.scheduledAt} item={popup.item} run={popup.run} onClose={popup.close} /> : null
}
