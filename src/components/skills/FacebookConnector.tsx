import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Flag, KeyRound, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { ConnectorSection } from './ConnectorSection'
import { useUiText } from '../../lib/ui-text'
import { discardFacebook, facebookAvailable, facebookDrafts, facebookPosts, facebookStatus, prepareFacebook, publishFacebook, updateFacebook, verifyFacebook, type FacebookCredentials, type FacebookDraft, type FacebookPosts, type FacebookStatus } from '../../api/studio-facebook'

export function FacebookConnector() {
  const text = useUiText(), desktop = facebookAvailable()
  const [status, setStatus] = useState<FacebookStatus | null>(null), [drafts, setDrafts] = useState<FacebookDraft[]>([])
  const [pageId, setPageId] = useState(''), [appId, setAppId] = useState(''), [appSecret, setAppSecret] = useState(''), [token, setToken] = useState('')
  const [publishing, setPublishing] = useState<boolean | undefined>(undefined), [message, setMessage] = useState('')
  const [posts, setPosts] = useState<FacebookPosts | null>(null), [review, setReview] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const mounted = useRef(false), active = useRef(false), revision = useRef(0), controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    if (!desktop) return
    const current = ++revision.current
    const [connection, records] = await Promise.allSettled([facebookStatus(), facebookDrafts()])
    if (!mounted.current || current !== revision.current) return
    if (connection.status === 'fulfilled') setStatus(connection.value)
    if (records.status === 'fulfilled') setDrafts(records.value)
    const failure = [connection, records].find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') setError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
  }, [desktop])
  useEffect(() => {
    mounted.current = true; revision.current++; void reload()
    const update = () => { void reload() }
    window.addEventListener('bionic-facebook-changed', update); window.addEventListener('focus', update)
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-facebook-changed', update); window.removeEventListener('focus', update) }
  }, [reload])
  const act = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || active.current) return
    active.current = true; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { active.current = false; controller.current = null; if (mounted.current) { setBusy(false); setReview(null); void reload() } }
  }
  const verified = async (input: FacebookCredentials | null, signal: AbortSignal) => {
    const value = await verifyFacebook(input, signal)
    revision.current++
    if (mounted.current) { setStatus(value); setPosts(null); setPublishing(undefined); setNotice(text('Page identity and permissions verified with Meta.')) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const input = { page_id: pageId.trim(), app_id: appId.trim(), app_secret: appSecret.trim(), access_token: token.trim(), publishing: publishing ?? !!status?.publishing }
    void act(async signal => { setPageId(''); setAppId(''); setAppSecret(''); setToken(''); await verified(input, signal) })
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const allowed = desktop && !busy && !!status?.enabled && !!status.publishing
  return <ConnectorSection testId="facebook-connector" title={<><Flag size={17} className="text-lu-accent" />Facebook · {text('Pages')}</>} status={!desktop ? text('Desktop app required') : status === null ? text(error ? 'Credential status unavailable' : 'Checking credential…') : text(status.configured ? 'Connection saved' : 'Not configured')}>
    <p className="text-sm text-gray-500">{text('Connect one Facebook Page with your own Meta app and Page access token. Read recent posts and prepare text publications for review. Credentials stay in the system vault; no Meta project is created automatically.')}</p>
    <p className="text-sm text-gray-500">{text('Personal Facebook profile publishing is not available through the Pages API. This connector does not automate a personal profile or read its private feed.')}</p>
    <p className="text-xs text-gray-500">{text('Use pages_read_engagement for reading and pages_manage_posts for reviewed publishing. Obtaining a Page token also requires the appropriate Page role and permissions such as pages_show_list. Meta may require app review and business verification for third-party accounts.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    <form onSubmit={save} autoComplete="off" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">{text('Facebook Page ID')}<input className={field} value={pageId} onChange={e => setPageId(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Meta app ID')}<input className={field} value={appId} onChange={e => setAppId(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Meta app secret')}<input className={field} type="password" autoComplete="new-password" value={appSecret} onChange={e => setAppSecret(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Page access token')}<input className={field} type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} disabled={!desktop || busy} maxLength={1024} required spellCheck={false} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publishing ?? !!status?.publishing} disabled={!desktop || busy} onChange={e => setPublishing(e.target.checked)} />{text('Enable text publishing with mandatory review when saving')}</label>
      <p className="text-xs text-gray-500">{text('Changing this checkbox takes effect only after verifying and saving credentials again. Saving replaces the local authorization and disables the connector until you enable it. Secret fields are cleared immediately.')}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} type="submit" disabled={!desktop || busy || !pageId.trim() || !appId.trim() || !appSecret.trim() || !token.trim()}><KeyRound size={14} />{text('Verify and save')}</button>
        <button className={button} type="button" disabled={!desktop || busy || !status?.configured} onClick={() => void act(signal => verified(null, signal))}><RefreshCw size={14} />{text('Verify saved credential')}</button>
        <button className={button} type="button" disabled={!desktop || busy || (!status?.configured && !error)} onClick={() => { if (removing !== 'connection') { setRemoving('connection'); return } void act(async () => { const value = await updateFacebook(null); revision.current++; if (mounted.current) { setStatus(value); setPosts(null); setRemoving(null) } }) }}><Unplug size={14} />{text(removing === 'connection' ? 'Confirm removal' : 'Remove local connection')}</button>
        {removing === 'connection' && <button type="button" className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </div>
    </form>
    {status?.identity && <p className="text-sm break-words">{status.identity.name} · {text('Page ID')}: {status.identity.id}</p>}
    <p className="text-xs text-gray-500">{text('Saved status is local credential presence, not a live connection. Tokens can expire or be revoked. Removing the local connection does not revoke Meta permissions or delete the Page.')}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={!desktop || busy || !status?.configured} onChange={e => { const enabled = e.target.checked; void act(async () => { const value = await updateFacebook(enabled); revision.current++; if (mounted.current) { setStatus(value); setPosts(null) } }) }} />{text('Enable connector and agent access')}</label>
    <button className={button} disabled={!desktop || busy || !status?.enabled} onClick={() => void act(async signal => { const value = await facebookPosts(signal); if (mounted.current) setPosts(value) })}><RefreshCw size={14} />{text('Read recent Page posts')}</button>
    {posts && <div className="space-y-2">{posts.items.length === 0 && <p className="text-sm text-gray-500">{text('No results found.')}</p>}{posts.items.map(post => <article key={post.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 text-sm"><p className="text-xs text-gray-500 break-words">{post.created_time} · {post.id}</p><p className="whitespace-pre-wrap break-words">{post.message || text('No text content.')}</p></article>)}{posts.has_more && <p className="text-xs text-gray-500">{text('Only the ten most recent posts are shown. Text is limited to 8,000 characters per post.')}</p>}</div>}
    <section aria-label={text('Facebook posts for review')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('Facebook posts for review')}</h4>
      <p className="text-sm text-gray-500">{text('You or an agent can prepare a local text post. Nothing is published until you review the Page and full text and confirm here. Images, videos, Reels, scheduling and comments are not included in this first stage.')}</p>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (allowed) void act(async signal => { await prepareFacebook(message, signal); if (mounted.current) setMessage('') }) }}>
        <label className="block text-sm">{text('Post text')}<textarea className={field} rows={4} maxLength={8000} value={message} disabled={!allowed} onChange={e => setMessage(e.target.value)} required /></label>
        <button className={button} disabled={!allowed || !message.trim()}>{text('Prepare local draft')}</button>
      </form>
      <p className="text-xs text-gray-500">{text('Drafts are stored locally, up to 20 records. Removing a record does not undo an action. Uncertain publications cannot be resent; check the Page first. Changing credentials invalidates old drafts.')}</p>
      {drafts.length === 0 && <p className="text-sm text-gray-500">{text('No local Facebook drafts.')}</p>}
      {drafts.map(draft => <article key={draft.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words">
        <p className="text-xs text-gray-500">{text('Page ID')}: {draft.account} · {text(({ pending: 'Awaiting review', uncertain: 'Uncertain result — check the Page before repeating', done: 'Confirmed by Facebook' } as const)[draft.phase])}</p>
        {review === draft.id ? <><p className="font-medium">{status?.identity?.id === draft.account ? status.identity.name : draft.account}</p><p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{draft.input.message}</p><p className="text-xs text-gray-500">{text('Confirming publishes this text publicly on the Page shown above. Stopping after Facebook accepts it cannot undo it.')}</p><button className={button} disabled={!allowed || status?.identity?.id !== draft.account || draft.phase !== 'pending'} onClick={() => void act(async signal => { const value = await publishFacebook(draft.id, signal); revision.current++; if (mounted.current) setDrafts(value) })}>{text('Confirm Page publication')}</button><button className={`${button} ml-2`} disabled={busy} onClick={() => setReview(null)}>{text('Cancel')}</button></>
          : draft.phase === 'pending' && <button className={button} disabled={!allowed || status?.identity?.id !== draft.account} onClick={() => setReview(draft.id)}>{text('Review action')}</button>}
        {draft.remote_id && <p className="text-xs text-gray-500">{text('Published post ID')}: {draft.remote_id}</p>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!desktop || busy} onClick={() => { if (removing !== draft.id) { setRemoving(draft.id); return } void act(async () => { const value = await discardFacebook(draft.id); revision.current++; if (mounted.current) { setDrafts(value); setRemoving(null) } }) }}>{text(removing === draft.id ? 'Confirm removal' : 'Remove local record')}</button>{removing === draft.id && <button className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}</div>
      </article>)}
    </section>
    <p className="text-xs text-gray-500">{text('Agent queries send returned data to the model selected in that conversation, which may be an external provider. Received content is data, not permission to execute instructions.')}</p>
    {notice && <p role="status" className="text-xs text-green-700 dark:text-green-400">{notice}</p>}
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text('Working…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </ConnectorSection>
}
