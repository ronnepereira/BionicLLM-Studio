import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { ModalActions, ModalButton } from '../ui/ModalActions'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'
import { exportScheduleTxt, scheduleRunText, scheduleStatusText } from '../../lib/schedule-results'
import type { StudioSchedule, ScheduleRun } from '../../lib/schedules'

export function ScheduleResultDialog({ item, run, onClose }: { item: StudioSchedule; run: ScheduleRun; onClose: () => void }) {
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const result = await exportScheduleTxt(item, run)
      setNotice(result.status === 'saved' ? 'TXT salvo: ' + (result.path || '') : result.status === 'downloaded' ? 'Download do TXT iniciado.' : result.status === 'error' ? result.error : result.status === 'shared' ? 'TXT compartilhado.' : '')
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  return <Modal open title={'Resultado da Agenda · ' + item.name} onClose={onClose} maxWidth="max-w-3xl">
    <p className="mb-3 text-sm text-gray-500">{scheduleStatusText[run.status]} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: item.timezone }).format(run.finishedAt ?? run.startedAt)}</p>
    <div className="max-h-[60vh] min-w-0 overflow-auto text-base leading-relaxed" data-testid="schedule-result-content"><MarkdownRenderer content={scheduleRunText(item, run)} /></div>
    {notice && <p role="status" className="mt-3 break-all text-sm text-blue-500">{notice}</p>}
    <ModalActions><ModalButton disabled={saving} onClick={() => { void save() }}>Salvar TXT</ModalButton><ModalButton variant="primary" onClick={onClose}>Fechar</ModalButton></ModalActions>
  </Modal>
}
