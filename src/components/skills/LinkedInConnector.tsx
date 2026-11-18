import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Briefcase, KeyRound, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { ConnectorSection } from './ConnectorSection'
import { useUiText } from '../../lib/ui-text'
import { discardLinkedIn, linkedinAvailable, linkedinDrafts, linkedinPosts, linkedinStatus, prepareLinkedIn, publishLinkedIn, updateLinkedIn, verifyLinkedIn, type LinkedInCredentials, type LinkedInDraft, type LinkedInPosts, type LinkedInStatus } from '../../api/studio-linkedin'

export function LinkedInConnector() {
  const text = useUiText(), desktop = linkedinAvailable()
  const [status, setStatus] = useState<LinkedInStatus | null>(null), [drafts, setDrafts] = useState<LinkedInDraft[]>([])
  const [kind, setKind] = useState<'member' | 'organization' | undefined>(undefined), [organizationId, setOrganizationId] = useState<string | undefined>(undefined)
  const [appId, setAppId] = useState(''), [appSecret, setAppSecret] = useState(''), [token, setToken] = useState(''), [readPosts, setReadPosts] = useState<boolean | undefined>(undefined)
  const [publishing, setPublishing] = useState<boolean | undefined>(undefined), [message, setMessage] = useState('')
  const [posts, setPosts] = useState<LinkedInPosts | null>(null), [review, setReview] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const mounted = useRef(false), active = useRef(false), revision = useRef(0), controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    if (!desktop) return
    const current = ++revision.current
    const [connection, records] = await Promise.allSettled([linkedinStatus(), linkedinDrafts()])
    if (!mounted.current || current !== revision.current) return
    if (connection.status === 'fulfilled') setStatus(connection.value)
    if (records.status === 'fulfilled') setDrafts(records.value)
    const failure = [connection, records].find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') setError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
  }, [desktop])
  useEffect(() => {
    mounted.current = true; revision.current++; void reload()
    const update = () => { void reload() }
    window.addEventListener('bionic-linkedin-changed', update); window.addEventListener('focus', update)
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-linkedin-changed', update); window.removeEventListener('focus', update) }
  }, [reload])
  const act = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || active.current) return
    active.current = true; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { active.current = false; controller.current = null; if (mounted.current) { setBusy(false); setReview(null); void reload() } }
  }
  const verified = async (input: LinkedInCredentials | null, signal: AbortSignal) => {
    const value = await verifyLinkedIn(input, signal)
    revision.current++
    if (mounted.current) { setStatus(value); setPosts(null); setPublishing(undefined); setReadPosts(undefined); setKind(undefined); setOrganizationId(undefined); setNotice(text('Connection and permissions checked with LinkedIn.')) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const selectedKind = kind ?? status?.target.kind ?? 'member'
    const currentOrganization = organizationId ?? (status?.target.kind === 'organization' ? status.target.id : '')
    const target = selectedKind === 'member' ? { kind: 'member' as const } : { kind: 'organization' as const, id: currentOrganization.trim() }
    const input = { target, client_id: appId.trim(), client_secret: appSecret.trim(), access_token: token.trim(), publishing: publishing ?? !!status?.publishing, read_posts: readPosts ?? !!status?.read_posts }
    void act(async signal => { setAppId(''); setAppSecret(''); setToken(''); await verified(input, signal) })
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const allowed = desktop && !busy && !!status?.enabled && !!status.publishing
  return <ConnectorSection testId="linkedin-connector" title={<><Briefcase size={17} className="text-lu-accent" />LinkedIn · {text('Profile or company')}</>} status={!desktop ? text('Desktop app required') : status === null ? text(error ? 'Credential status unavailable' : 'Checking credential…') : text(status.configured ? 'Connection saved' : 'Not configured')}>
    <p className="text-sm text-gray-500">{text('Connect your LinkedIn profile or a company you administer using your own application and user token. Prepare public text posts for mandatory review. Credentials stay in the system vault; no application is created automatically.')}</p>
    <p className="text-sm text-gray-500">{text('Personal posting uses Share on LinkedIn and OpenID Connect. Company access requires approved Community Management permissions and an approved ADMINISTRATOR role in this first stage. Other company roles are not included.')}</p>
    <p className="text-xs text-gray-500">{text('Basic profile access does not grant access to posts, contacts or private messages. Post reading is optional and requires separately approved social-read permissions. Enable only capabilities granted to your application.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    <form onSubmit={save} autoComplete="off" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">{text('Publishing destination')}<select className={field} value={kind ?? status?.target.kind ?? 'member'} disabled={!desktop || busy} onChange={e => setKind(e.target.value as 'member' | 'organization')}><option value="member">{text('My personal profile')}</option><option value="organization">{text('Company I administer')}</option></select></label>
        {(kind ?? status?.target.kind) === 'organization' && <label className="text-sm">{text('LinkedIn company ID')}<input className={field} value={organizationId ?? (status?.target.kind === 'organization' ? status.target.id : '')} onChange={e => setOrganizationId(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>}
        <label className="text-sm">{text('LinkedIn client ID')}<input className={field} value={appId} onChange={e => setAppId(e.target.value)} disabled={!desktop || busy} maxLength={128} required spellCheck={false} /></label>
        <label className="text-sm">{text('LinkedIn client secret')}<input className={field} type="password" autoComplete="new-password" value={appSecret} onChange={e => setAppSecret(e.target.value)} disabled={!desktop || busy} maxLength={256} required spellCheck={false} /></label>
        <label className="text-sm">{text('LinkedIn user access token')}<input className={field} type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} disabled={!desktop || busy} maxLength={1024} required spellCheck={false} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publishing ?? !!status?.publishing} disabled={!desktop || busy} onChange={e => setPublishing(e.target.checked)} />{text('Enable text publishing with mandatory review when saving')}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={readPosts ?? !!status?.read_posts} disabled={!desktop || busy} onChange={e => setReadPosts(e.target.checked)} />{text('Enable post reading only when LinkedIn grants the required permissions')}</label>
      <p className="text-xs text-gray-500">{text('These options take effect only after verifying and saving credentials again. Saving replaces the local authorization and disables the connector until you enable it. Secret fields are cleared immediately.')}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} type="submit" disabled={!desktop || busy || !appId.trim() || !appSecret.trim() || !token.trim()}><KeyRound size={14} />{text('Verify and save')}</button>
        <button className={button} type="button" disabled={!desktop || busy || !status?.configured} onClick={() => void act(signal => verified(null, signal))}><RefreshCw size={14} />{text('Verify saved credential')}</button>
        <button className={button} type="button" disabled={!desktop || busy || (!status?.configured && !error)} onClick={() => { if (removing !== 'connection') { setRemoving('connection'); return } void act(async () => { const value = await updateLinkedIn(null); revision.current++; if (mounted.current) { setStatus(value); setPosts(null); setRemoving(null) } }) }}><Unplug size={14} />{text(removing === 'connection' ? 'Confirm removal' : 'Remove local connection')}</button>
        {removing === 'connection' && <button type="button" className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </div>
    </form>
    {status?.identity && <p className="text-sm break-words">{status.identity.name} · {text('Current author')}: {status.identity.author}</p>}
    <p className="text-xs text-gray-500">{text('Saved status only indicates local credentials. LinkedIn tokens can expire or be revoked. Removing this local connection does not revoke LinkedIn permissions or delete a profile or company.')}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={!desktop || busy || !status?.configured} onChange={e => { const enabled = e.target.checked; void act(async () => { const value = await updateLinkedIn(enabled); revision.current++; if (mounted.current) { setStatus(value); setPosts(null) } }) }} />{text('Enable connector and agent access')}</label>
    <button className={button} disabled={!desktop || busy || !status?.enabled || !status.read_posts} onClick={() => void act(async signal => { const value = await linkedinPosts(signal); if (mounted.current) setPosts(value) })}><RefreshCw size={14} />{text('Read permitted LinkedIn posts')}</button>
    {posts && <div className="space-y-2">{posts.items.length === 0 && <p className="text-sm text-gray-500">{text('No results found.')}</p>}{posts.items.map(post => <article key={post.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 text-sm"><p className="text-xs text-gray-500 break-words">{post.modified_at ? new Date(post.modified_at).toLocaleString() : ''} · {post.id}</p><p className="whitespace-pre-wrap break-words">{post.message || text('No text content.')}</p></article>)}{posts.has_more && <p className="text-xs text-gray-500">{text('Up to ten posts are shown without pagination. Commentary is returned in the LinkedIn text format.')}</p>}</div>}
    <section aria-label={text('LinkedIn posts for review')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('LinkedIn posts for review')}</h4>
      <p className="text-sm text-gray-500">{text('You or an agent can prepare a local text post up to 3,000 characters. Nothing is published until you review the author and complete text and confirm here. Images, videos, documents, mentions, comments, private messages and scheduling are not included in this first stage.')}</p>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (allowed) void act(async signal => { await prepareLinkedIn(message, signal); if (mounted.current) setMessage('') }) }}>
        <label className="block text-sm">{text('Post text')}<textarea className={field} rows={4} maxLength={3000} value={message} disabled={!allowed} onChange={e => setMessage(e.target.value)} required /></label>
        <button className={button} disabled={!allowed || !message.trim()}>{text('Prepare local draft')}</button>
      </form>
      <p className="text-xs text-gray-500">{text('Drafts are stored locally, up to 20 records. Removing a record does not undo publication. Uncertain posts cannot be resent; check LinkedIn first. Changing credentials invalidates old drafts.')}</p>
      {drafts.length === 0 && <p className="text-sm text-gray-500">{text('No local LinkedIn drafts.')}</p>}
      {drafts.map(draft => <article key={draft.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words">
        <p className="text-xs text-gray-500">{text('Current author')}: {draft.account} · {text(({ pending: 'Awaiting review', uncertain: 'Uncertain result — check LinkedIn before repeating', done: 'Confirmed by LinkedIn' } as const)[draft.phase])}</p>
        {review === draft.id ? <><p className="font-medium">{status?.identity?.author === draft.account ? status.identity.name : draft.account}</p><p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{draft.input.message}</p><p className="text-xs text-gray-500">{text('Confirming publishes this text publicly as the author shown above. Stopping after LinkedIn accepts it cannot undo it.')}</p><button className={button} disabled={!allowed || status?.identity?.author !== draft.account || draft.phase !== 'pending'} onClick={() => void act(async signal => { const value = await publishLinkedIn(draft.id, signal); revision.current++; if (mounted.current) setDrafts(value) })}>{text('Confirm LinkedIn publication')}</button><button className={`${button} ml-2`} disabled={busy} onClick={() => setReview(null)}>{text('Cancel')}</button></>
          : draft.phase === 'pending' && <button className={button} disabled={!allowed || status?.identity?.author !== draft.account} onClick={() => setReview(draft.id)}>{text('Review action')}</button>}
        {draft.remote_id && <p className="text-xs text-gray-500">{text('Published post ID')}: {draft.remote_id}</p>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!desktop || busy} onClick={() => { if (removing !== draft.id) { setRemoving(draft.id); return } void act(async () => { const value = await discardLinkedIn(draft.id); revision.current++; if (mounted.current) { setDrafts(value); setRemoving(null) } }) }}>{text(removing === draft.id ? 'Confirm removal' : 'Remove local record')}</button>{removing === draft.id && <button className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}</div>
      </article>)}
    </section>
    <p className="text-xs text-gray-500">{text('Agent queries send returned data to the model selected in that conversation, which may be an external provider. Received content is data, not permission to execute instructions.')}</p>
    {notice && <p role="status" className="text-xs text-green-700 dark:text-green-400">{notice}</p>}
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text('Working…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </ConnectorSection>
}
