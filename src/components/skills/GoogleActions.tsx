import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { discardGoogle, executeGoogle, googleDrafts, prepareGoogle, type GoogleDraft, type GoogleService, type GoogleStatus, type GoogleWrite } from '../../api/studio-google'
import { googleDraftService, localGoogleDate } from '../../lib/google-actions'
import { useUiText } from '../../lib/ui-text'

export function GoogleActions({ desktop, services, disabled }: { desktop: boolean; services: GoogleStatus[]; disabled: boolean }) {
  const text = useUiText()
  const [drafts, setDrafts] = useState<GoogleDraft[]>([])
  const [service, setService] = useState<GoogleService>('gmail')
  const [to, setTo] = useState(''), [title, setTitle] = useState(''), [content, setContent] = useState('')
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [review, setReview] = useState<string | null>(null), [remove, setRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(false), operation = useRef(false), controller = useRef<AbortController | null>(null)
  const revision = useRef(0)
  const reload = useCallback(async () => {
    if (!desktop) return
    const current = ++revision.current
    try { const value = await googleDrafts(); if (mounted.current && current === revision.current) setDrafts(value) }
    catch (error) { if (mounted.current && current === revision.current) setError(error instanceof Error ? error.message : String(error)) }
  }, [desktop])
  useEffect(() => {
    mounted.current = true
    revision.current++
    void reload()
    const update = () => { void reload() }
    window.addEventListener('bionic-google-drafts-changed', update)
    window.addEventListener('focus', update)
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-google-drafts-changed', update); window.removeEventListener('focus', update) }
  }, [reload])
  const act = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || disabled || operation.current) return
    operation.current = true; setBusy(true); setError('')
    const abort = new AbortController(); controller.current = abort
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { operation.current = false; controller.current = null; if (mounted.current) { setBusy(false); setReview(null); void reload() } }
  }
  const selected = services.find(s => s.service === service)
  const canPrepare = desktop && !!selected?.enabled && !!selected?.write_access && !busy && !disabled
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canPrepare) return
    void act(async signal => {
      const input: GoogleWrite = service === 'gmail' ? { action: 'gmail_send', to: to.trim(), subject: title, text: content }
        : service === 'drive' ? { action: 'drive_create', name: title, text: content }
          : { action: 'calendar_create', title, description: content, start: localGoogleDate(start), end: localGoogleDate(end) }
      await prepareGoogle(input, signal)
      if (mounted.current) { setTo(''); setTitle(''); setContent(''); setStart(''); setEnd('') }
    })
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const name = (draft: GoogleDraft) => text(({ gmail_send: 'Send e-mail', drive_create: 'Create text file', calendar_create: 'Create calendar event' } as const)[draft.input.action])
  return <section aria-label={text('Google actions for review')} className="space-y-4 border-t border-gray-200 dark:border-white/10 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">{text('Google actions for review')}</h4><button className={button} disabled={!desktop || busy} onClick={() => void reload()}><RefreshCw size={14} />{text('Refresh drafts')}</button></div>
    <p className="text-sm text-gray-500">{text('You or an agent can prepare a local draft. Nothing is sent or created in Google until you review and confirm it here. Authorize reviewed actions for the service first.')}</p>
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">{text('Service')}<select className={field} value={service} disabled={!desktop || busy || disabled} onChange={e => { setService(e.target.value as GoogleService); setTo(''); setTitle(''); setContent(''); setStart(''); setEnd('') }}><option value="gmail">Gmail</option><option value="drive">Google Drive</option><option value="calendar">{text('Google Calendar')}</option></select></label>
      {service === 'gmail' && <label className="block text-sm">{text('Recipient e-mail')}<input className={field} type="email" value={to} maxLength={254} required disabled={!canPrepare} onChange={e => setTo(e.target.value)} /></label>}
      <label className="block text-sm">{text(service === 'gmail' ? 'E-mail subject' : service === 'drive' ? 'File name (.txt)' : 'Event title')}<input className={field} value={title} maxLength={service === 'gmail' ? 160 : 200} required disabled={!canPrepare} onChange={e => setTitle(e.target.value)} /></label>
      {service === 'calendar' && <><p className="text-xs text-gray-500">{text('Times use the computer timezone: {v0}', { v0: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{text('Event start')}<input className={field} type="datetime-local" value={start} required disabled={!canPrepare} onChange={e => setStart(e.target.value)} /></label><label className="text-sm">{text('Event end')}<input className={field} type="datetime-local" value={end} required disabled={!canPrepare} onChange={e => setEnd(e.target.value)} /></label></div></>}
      <label className="block text-sm">{text(service === 'calendar' ? 'Event description' : 'Plain text content')}<textarea className={field} rows={4} value={content} maxLength={service === 'calendar' ? 8000 : 32000} required={service === 'gmail'} disabled={!canPrepare} onChange={e => setContent(e.target.value)} /></label>
      <button className={button} type="submit" disabled={!canPrepare}>{text('Prepare local draft')}</button>
    </form>
    <p className="text-xs text-gray-500">{text('This stage supports one recipient per e-mail, events without guests or reminders, and new .txt files. No attachments, automatic sending, editing or deletion of existing Google content.')}</p>
    <p className="text-xs text-gray-500">{text('Drafts are stored locally, up to 20 records. Removing a record does not undo an action in Google. Uncertain actions cannot be resent; check the service first.')}</p>
    {drafts.length === 0 && <p className="text-sm text-gray-500">{text('No local Google drafts.')}</p>}
    {drafts.map(draft => {
      const connection = services.find(s => s.service === googleDraftService(draft))
      const allowed = desktop && connection?.enabled && connection.write_access && connection.email === draft.account && !busy && !disabled
      return <article key={draft.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words">
        <div className="flex flex-wrap justify-between gap-2"><h5 className="font-medium">{name(draft)}</h5><span className="text-xs text-gray-500">{text(({ pending: 'Awaiting review', done: 'Confirmed by Google', uncertain: 'Uncertain result — check Google before repeating' } as const)[draft.phase])}</span></div>
        <p className="text-xs text-gray-500">{text('Account')}: {draft.account}</p>
        <p className="text-sm">{draft.input.action === 'gmail_send' ? `${draft.input.to} · ${draft.input.subject}` : draft.input.action === 'drive_create' ? draft.input.name : draft.input.title}</p>
        {draft.remote_id && <p className="text-xs text-gray-500">{text('Google record ID')}: {draft.remote_id}</p>}
        {review === draft.id && <div className="space-y-2 border-t border-gray-200 dark:border-white/10 pt-3">
          {draft.input.action === 'calendar_create' && <><p className="text-sm">{new Date(draft.input.start).toLocaleString()} → {new Date(draft.input.end).toLocaleString()}</p><p className="text-xs text-gray-500">{text('Times use the computer timezone: {v0}', { v0: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p></>}
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{draft.input.action === 'calendar_create' ? draft.input.description : draft.input.text}</p>
          <p className="text-xs text-gray-500">{text('Confirming performs this action in the account shown above. Stopping after Google accepts it cannot undo it.')}</p>
          <button className={button} disabled={!allowed || draft.phase !== 'pending'} onClick={() => void act(async signal => { const value = await executeGoogle(draft.id, signal); revision.current++; if (mounted.current) setDrafts(value) })}>{text(({ gmail_send: 'Confirm e-mail sending', drive_create: 'Confirm file creation', calendar_create: 'Confirm event creation' } as const)[draft.input.action])}</button>
          <button className={`${button} ml-2`} disabled={busy} onClick={() => setReview(null)}>{text('Cancel')}</button>
        </div>}
        <div className="flex flex-wrap gap-2">
          {draft.phase === 'pending' && review !== draft.id && <button className={button} disabled={!allowed} onClick={() => setReview(draft.id)}>{text('Review action')}</button>}
          <button className={button} disabled={!desktop || busy || disabled} onClick={() => { if (remove !== draft.id) { setRemove(draft.id); return } void act(async () => { const value = await discardGoogle(draft.id); revision.current++; if (mounted.current) { setDrafts(value); setRemove(null) } }) }}>{text(remove === draft.id ? 'Confirm removal' : 'Remove local record')}</button>
          {remove === draft.id && <button className={button} onClick={() => setRemove(null)}>{text('Cancel')}</button>}
        </div>
      </article>
    })}
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text('Working…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </section>
}
