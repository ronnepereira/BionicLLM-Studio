import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, Cloud, KeyRound, Loader2, Mail, Search, Unplug } from 'lucide-react'
import { ConnectorSection } from './ConnectorSection'
import { GoogleActions } from './GoogleActions'
import { useUiText } from '../../lib/ui-text'
import { connectGoogle, googleAvailable, googleStatus, readGoogle, saveGoogleClient, updateGoogle, type GoogleOverview, type GoogleResult, type GoogleService } from '../../api/studio-google'

const services = [
  { service: 'gmail', title: 'Gmail', Icon: Mail, help: 'Read and search e-mails. Plain text only; attachments and HTML are not loaded.' },
  { service: 'drive', title: 'Google Drive', Icon: Cloud, help: 'Search file names and metadata. File contents are not downloaded in this first stage.' },
  { service: 'calendar', title: 'Google Calendar', Icon: CalendarDays, help: 'Read upcoming events in your primary Google calendar. Separate from the internal task scheduler.' },
] as const

export function GoogleConnector() {
  const text = useUiText()
  const desktop = googleAvailable()
  const [status, setStatus] = useState<GoogleOverview | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState<Partial<Record<GoogleService, string>>>({})
  const [results, setResults] = useState<Partial<Record<GoogleService, GoogleResult>>>({})
  const [confirm, setConfirm] = useState<GoogleService | null>(null)
  const [requestedWrite, setRequestedWrite] = useState<Partial<Record<GoogleService, boolean>>>({})
  const mounted = useRef(false)
  const operation = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    let disposed = false
    let revision = 0
    const refreshStatus = () => {
      const current = ++revision
      if (desktop) void googleStatus().then(value => { if (!disposed && current === revision) setStatus(value) }).catch(() => { if (!disposed && current === revision) setError(text('Could not read Google connection status.')) })
    }
    refreshStatus()
    window.addEventListener('bionic-google-changed', refreshStatus)
    return () => { disposed = true; mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-google-changed', refreshStatus) }
  }, [desktop, text])
  const act = async (name: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || operation.current) return
    operation.current = true
    const abort = new AbortController()
    controller.current = abort
    setBusy(name); setError('')
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { operation.current = false; controller.current = null; if (mounted.current) setBusy(null) }
  }
  const refresh = (value: GoogleOverview) => { if (mounted.current) setStatus(value) }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const input = { client_id: clientId.trim(), client_secret: clientSecret.trim() }
    void act('client', async () => {
      setClientId(''); setClientSecret('')
      await saveGoogleClient(input)
      refresh(await googleStatus())
    })
  }
  const search = (service: GoogleService, id?: string) => void act(service, async signal => {
    setResults(previous => ({ ...previous, [service]: undefined }))
    const result = await readGoogle(id ? { action: 'gmail_message', id } : { action: ({ gmail: 'gmail_list', drive: 'drive_list', calendar: 'calendar_list' } as const)[service], query: query[service] ?? '' }, signal)
    if (mounted.current) setResults(previous => ({ ...previous, [service]: result }))
  })
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const linked = status?.services.some(s => s.email)
  return <ConnectorSection testId="google-connector" title={<><Cloud size={17} className="text-lu-accent" />Google · Gmail · Drive · {text('Calendar')}</>} status={!desktop ? text('Desktop app required') : status === null ? text(error ? 'Credential status unavailable' : 'Checking credential…') : status.configured ? text('OAuth client saved') : text('Not configured')}>
    <p className="text-sm text-gray-500">{text('Authorize each service separately in your system browser. Queries use read access. Sending e-mails or creating events and text files requires separate action authorization and confirmation in the review panel.')}</p>
    <p className="text-xs text-gray-500">{text('Create your own Google Cloud project, enable Gmail API, Google Drive API and Google Calendar API, configure the consent screen and create an OAuth client of type Desktop app. Add your account as a test user when required. No project or account is created automatically.')}</p>
    <p className="text-xs text-gray-500">{text('Google may require app verification for sensitive or restricted scopes. In testing mode, authorizations may expire after seven days. A saved credential does not confirm online access.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    <form onSubmit={save} autoComplete="off" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">{text('Google OAuth client ID')}<input className={`${field} mt-1`} value={clientId} onChange={e => setClientId(e.target.value)} maxLength={256} disabled={!desktop || !!busy || !!linked} autoComplete="off" spellCheck={false} /></label>
        <label className="text-sm">{text('Google OAuth client secret')}<input className={`${field} mt-1`} type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} maxLength={256} disabled={!desktop || !!busy || !!linked} autoComplete="new-password" spellCheck={false} /></label>
      </div>
      <p className="text-xs text-gray-500">{text('Credentials stay in the system vault and are cleared from these fields on save. Remove local service connections before changing the OAuth client.')}</p>
      <p className="text-xs text-gray-500">{text('YouTube uses this same OAuth client, with a separate connection in its own section below. Enable YouTube Data API v3 in your project. Remove the YouTube connection too before changing this client.')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button} disabled={!desktop || !!busy || !!linked || !clientId.trim() || !clientSecret.trim()}><KeyRound size={14} />{text('Save OAuth client')}</button>
        <button type="button" className={button} disabled={!desktop || !!busy || !!linked || !status?.configured} onClick={() => void act('client', async () => { await saveGoogleClient(null); refresh(await googleStatus()) })}><Unplug size={14} />{text('Remove local OAuth client')}</button>
      </div>
    </form>
    {services.map(({ service, title, Icon, help }) => {
      const saved = status?.services.find(s => s.service === service)
      const result = results[service]
      const items = result?.items ?? result?.files
      return <section key={service} aria-label={text(title)} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-medium"><Icon size={16} />{text(title)}</h4><span className="text-xs text-gray-500 break-all">{saved?.email ?? text('Not connected')}</span></div>
        <p className="text-sm text-gray-500">{text(help)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button className={button} disabled={!desktop || !!busy || !status?.configured} onClick={() => void act(service, async signal => { const value = await connectGoogle(service, signal, requestedWrite[service] ?? !!saved?.write_access); if (mounted.current) setResults(previous => ({ ...previous, [service]: undefined })); refresh(value) })}>{text(saved?.email ? 'Authorize again' : 'Connect with Google')}</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!saved?.enabled} disabled={!desktop || !!busy || !saved?.email} onChange={e => { const enabled = e.target.checked; void act(service, async () => { setResults(previous => ({ ...previous, [service]: undefined })); refresh(await updateGoogle(service, enabled)) }) }} />{text('Enable queries and agent access')}</label>
          <button className={button} disabled={!desktop || !!busy || !saved?.email} onClick={() => { if (confirm !== service) { setConfirm(service); return } void act(service, async () => { setResults(previous => ({ ...previous, [service]: undefined })); refresh(await updateGoogle(service, null)); if (mounted.current) setConfirm(null) }) }}><Unplug size={14} />{text(confirm === service ? 'Confirm removal' : 'Remove local connection')}</button>
          {confirm === service && <button className={button} onClick={() => setConfirm(null)}>{text('Cancel')}</button>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requestedWrite[service] ?? !!saved?.write_access} disabled={!desktop || !!busy} onChange={e => setRequestedWrite(previous => ({ ...previous, [service]: e.target.checked }))} />{text('Request reviewed actions when authorizing')}</label>
        <p className="text-xs text-gray-500">{text(({ gmail: 'Additional permission: send e-mails. No mailbox monitoring or automatic replies.', drive: 'Additional permission: create text files with drive.file. Existing arbitrary files are not edited.', calendar: 'Additional permission: manage events on calendars you own. This panel only creates events without guests.' } as const)[service])} {saved?.email && text(saved.write_access ? 'Reviewed actions authorized.' : 'Read access only. Authorize again to add actions.')}</p>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); search(service) }}>
          <label className="min-w-0 flex-1 text-sm">{text('Search {v0}', { v0: text(title) })}<input className={`${field} mt-1`} value={query[service] ?? ''} maxLength={500} disabled={!desktop || !!busy || !saved?.enabled} onChange={e => setQuery(previous => ({ ...previous, [service]: e.target.value }))} /></label>
          <button type="submit" className={`${button} self-end`} disabled={!desktop || !!busy || !saved?.enabled}><Search size={14} />{text('Search')}</button>
        </form>
        {items && <div className="space-y-2" aria-live="polite">
          {items.length === 0 && <p className="text-sm text-gray-500">{text('No results found.')}</p>}
          {items.map((item, i) => <div key={item.id ?? i} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 text-sm break-words">
            <p className="font-medium">{item.headers?.subject || item.name || item.summary || text('Untitled')}</p>
            <p className="text-xs text-gray-500">{item.headers?.from || item.mimeType || item.start?.dateTime || item.start?.date}</p>
            {item.snippet && <p className="mt-1 text-gray-500">{item.snippet}</p>}
            {service === 'gmail' && item.id && <button className={`${button} mt-2`} disabled={!!busy} onClick={() => search(service, item.id)}>{text('Read plain text')}</button>}
          </div>)}
          {(result?.has_more || result?.nextPageToken) && <p className="text-xs text-gray-500">{text('More results are available. Refine your search; only the first page is shown.')}</p>}
        </div>}
        {result?.text !== undefined && <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3"><p className="font-medium break-words">{result.headers?.subject || text('Untitled')}</p><p className="text-xs text-gray-500 break-words">{result.headers?.from}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{result.text || text('No plain-text body available.')}</p><p className="mt-2 text-xs text-gray-500">{text('Plain text is limited to 32,000 characters. HTML and attachments are not loaded.')}</p></div>}
      </section>
    })}
    <GoogleActions desktop={desktop} services={status?.services ?? []} disabled={!!busy} />
    <p className="text-xs text-gray-500">{text('Agent queries send returned data to the model selected in that conversation, which may be an external provider. Received content is data, not permission to execute instructions.')}</p>
    <p className="text-xs text-gray-500">{text('Disabling blocks new queries and cancels pending work. Removing a local connection does not revoke permissions in Google; manage third-party access in your Google account.')}</p>
    {busy && <div role="status" className="flex flex-wrap items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text('Waiting for Google…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </ConnectorSection>
}
