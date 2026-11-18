import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, KeyRound, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { ConnectorSection } from './ConnectorSection'
import { useUiText } from '../../lib/ui-text'
import { discardInstagram, instagramAvailable, instagramDrafts, instagramMedia, instagramStatus, prepareInstagram, publishInstagram, updateInstagram, verifyInstagram, type InstagramCredentials, type InstagramDraft, type InstagramMedia, type InstagramStatus } from '../../api/studio-instagram'

export function InstagramConnector() {
  const text = useUiText(), desktop = instagramAvailable()
  const [status, setStatus] = useState<InstagramStatus | null>(null), [drafts, setDrafts] = useState<InstagramDraft[]>([])
  const [instagramId, setInstagramId] = useState('')
  const [kind, setKind] = useState<'image' | 'reel'>('image'), [url, setUrl] = useState(''), [shareToFeed, setShareToFeed] = useState(true), [publishingNow, setPublishingNow] = useState(false)
  const [pageId, setPageId] = useState(''), [appId, setAppId] = useState(''), [appSecret, setAppSecret] = useState(''), [token, setToken] = useState('')
  const [publishing, setPublishing] = useState<boolean | undefined>(undefined), [message, setMessage] = useState('')
  const [posts, setPosts] = useState<InstagramMedia | null>(null), [review, setReview] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const mounted = useRef(false), active = useRef(false), revision = useRef(0), controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    if (!desktop) return
    const current = ++revision.current
    const [connection, records] = await Promise.allSettled([instagramStatus(), instagramDrafts()])
    if (!mounted.current || current !== revision.current) return
    if (connection.status === 'fulfilled') setStatus(connection.value)
    if (records.status === 'fulfilled') setDrafts(records.value)
    const failure = [connection, records].find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') setError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
  }, [desktop])
  useEffect(() => {
    mounted.current = true; revision.current++; void reload()
    const update = () => { void reload() }
    window.addEventListener('bionic-instagram-changed', update); window.addEventListener('focus', update)
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-instagram-changed', update); window.removeEventListener('focus', update) }
  }, [reload])
  const act = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || active.current) return
    active.current = true; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { active.current = false; controller.current = null; if (mounted.current) { setBusy(false); setPublishingNow(false); setReview(null); void reload() } }
  }
  const verified = async (input: InstagramCredentials | null, signal: AbortSignal) => {
    const value = await verifyInstagram(input, signal)
    revision.current++
    if (mounted.current) { setStatus(value); setPosts(null); setPublishing(undefined); setNotice(text('Professional account, linked Page and Instagram permissions verified with Meta.')) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const input = { instagram_id: instagramId.trim(), page_id: pageId.trim(), app_id: appId.trim(), app_secret: appSecret.trim(), access_token: token.trim(), publishing: publishing ?? !!status?.publishing }
    void act(async signal => { setInstagramId(''); setPageId(''); setAppId(''); setAppSecret(''); setToken(''); await verified(input, signal) })
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const allowed = desktop && !busy && !!status?.enabled && !!status.publishing
  return <ConnectorSection testId="instagram-connector" title={<><Camera size={17} className="text-lu-accent" />Instagram · {text('Professional account')}</>} status={!desktop ? text('Desktop app required') : status === null ? text(error ? 'Credential status unavailable' : 'Checking credential…') : text(status.configured ? 'Connection saved' : 'Not configured')}>
    <p className="text-sm text-gray-500">{text('This connector uses Instagram API with Facebook Login: a professional Instagram account linked to a Facebook Page. Provide your Meta app and a Page token with Instagram permissions. Credentials stay in the system vault; no account or project is created automatically.')}</p>
    <p className="text-sm text-gray-500">{text('Consumer Instagram accounts are not supported. Direct Instagram Login is a different API setup and is not implemented in this first stage.')}</p>
    <p className="text-xs text-gray-500">{text('Use instagram_basic and pages_read_engagement for reading, plus instagram_content_publish for reviewed publication. Obtaining the Page token also depends on Page roles and pages_show_list. Meta may require app review and business verification.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    <form onSubmit={save} autoComplete="off" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">{text('Instagram professional account ID')}<input className={field} value={instagramId} onChange={e => setInstagramId(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Facebook Page ID')}<input className={field} value={pageId} onChange={e => setPageId(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Meta app ID')}<input className={field} value={appId} onChange={e => setAppId(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Meta app secret')}<input className={field} type="password" autoComplete="new-password" value={appSecret} onChange={e => setAppSecret(e.target.value)} disabled={!desktop || busy} maxLength={32} required spellCheck={false} /></label>
        <label className="text-sm">{text('Page access token')}<input className={field} type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} disabled={!desktop || busy} maxLength={1024} required spellCheck={false} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publishing ?? !!status?.publishing} disabled={!desktop || busy} onChange={e => setPublishing(e.target.checked)} />{text('Enable images and Reels with mandatory review when saving')}</label>
      <p className="text-xs text-gray-500">{text('Changing this checkbox takes effect only after verifying and saving credentials again. Saving replaces the local authorization and disables the connector until you enable it. Secret fields are cleared immediately.')}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} type="submit" disabled={!desktop || busy || !instagramId.trim() || !pageId.trim() || !appId.trim() || !appSecret.trim() || !token.trim()}><KeyRound size={14} />{text('Verify and save')}</button>
        <button className={button} type="button" disabled={!desktop || busy || !status?.configured} onClick={() => void act(signal => verified(null, signal))}><RefreshCw size={14} />{text('Verify saved credential')}</button>
        <button className={button} type="button" disabled={!desktop || busy || (!status?.configured && !error)} onClick={() => { if (removing !== 'connection') { setRemoving('connection'); return } void act(async () => { const value = await updateInstagram(null); revision.current++; if (mounted.current) { setStatus(value); setPosts(null); setRemoving(null) } }) }}><Unplug size={14} />{text(removing === 'connection' ? 'Confirm removal' : 'Remove local connection')}</button>
        {removing === 'connection' && <button type="button" className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </div>
    </form>
    {status?.identity && <p className="text-sm break-words">@{status.identity.username} · {text('Instagram account ID')}: {status.identity.id} · {text('Page ID')}: {status.identity.page_id}</p>}
    <p className="text-xs text-gray-500">{text('Saved status is local credential presence, not a live connection. Tokens can expire or be revoked. Removing the local connection does not revoke Meta permissions or delete your Instagram account.')}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={!desktop || busy || !status?.configured} onChange={e => { const enabled = e.target.checked; void act(async () => { const value = await updateInstagram(enabled); revision.current++; if (mounted.current) { setStatus(value); setPosts(null) } }) }} />{text('Enable connector and agent access')}</label>
    <button className={button} disabled={!desktop || busy || !status?.enabled} onClick={() => void act(async signal => { const value = await instagramMedia(signal); if (mounted.current) setPosts(value) })}><RefreshCw size={14} />{text('Read Instagram media')}</button>
    {posts && <div className="space-y-2">{posts.items.length === 0 && <p className="text-sm text-gray-500">{text('No results found.')}</p>}{posts.items.map(post => <article key={post.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 text-sm"><p className="text-xs text-gray-500 break-words">{post.timestamp} · {post.id}</p><p className="whitespace-pre-wrap break-words">{post.caption || text('No text content.')}</p></article>)}{posts.has_more && <p className="text-xs text-gray-500">{text('Up to ten media items are shown, without pagination. Captions are limited to 2,200 characters.')}</p>}</div>}
    <section aria-label={text('Instagram publications for review')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('Instagram publications for review')}</h4>
      <p className="text-sm text-gray-500">{text('Prepare an image post or Reel from a public HTTPS media URL. Meta fetches the file directly; this app does not host or upload local files. Nothing is published until you review the account, URL, format and caption and confirm here.')}</p>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (allowed) void act(async signal => { await prepareInstagram(kind === 'image' ? { kind, url: url.trim(), caption: message } : { kind, url: url.trim(), caption: message, share_to_feed: shareToFeed }, signal); if (mounted.current) { setMessage(''); setUrl('') } }) }}>
        <label className="block text-sm">{text('Media format')}<select className={field} value={kind} disabled={!allowed} onChange={e => { setKind(e.target.value as 'image' | 'reel'); setUrl('') }}><option value="image">{text('Image (JPEG)')}</option><option value="reel">{text('Reel (video)')}</option></select></label>
        <label className="block text-sm">{text('Public HTTPS media URL')}<input className={field} type="url" value={url} maxLength={2048} required disabled={!allowed} onChange={e => setUrl(e.target.value)} /></label>
        {kind === 'reel' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shareToFeed} disabled={!allowed} onChange={e => setShareToFeed(e.target.checked)} />{text('Also share this Reel to the feed')}</label>}
        <label className="block text-sm">{text('Caption (optional)')}<textarea className={field} rows={4} maxLength={2200} value={message} disabled={!allowed} onChange={e => setMessage(e.target.value)} /></label>
        <button className={button} disabled={!allowed || !url.trim()}>{text('Prepare local draft')}</button>
      </form>
      <p className="text-xs text-gray-500">{text('Images must be JPEG; Reels must meet Meta video requirements. URLs must work without login and stay available during processing. This app only validates the URL syntax; Meta validates the media. No Stories, carousels, comments, scheduling or automatic publishing in this stage.')}</p>
      <p className="text-xs text-gray-500">{text('Local drafts persist across restarts, up to 20 records. Removing a record does not undo publication. Unconfirmed processing or publications are never retried automatically; check Instagram before preparing another.')}</p>
      {drafts.length === 0 && <p className="text-sm text-gray-500">{text('No local Instagram drafts.')}</p>}
      {drafts.map(draft => <article key={draft.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words">
        <p className="text-xs text-gray-500">{text('Instagram account ID')}: {draft.account} · {text(({ pending: 'Awaiting review', uncertain: 'Processing or publication unconfirmed — check Instagram before repeating', done: 'Confirmed by Instagram' } as const)[draft.phase])}</p>
        {review === draft.id ? <><p className="font-medium">{status?.identity?.id === draft.account ? status.identity.username : draft.account}</p><p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{draft.input.caption || text('No caption.')}<span className="block mt-2 break-all">{draft.input.url}</span><span className="block mt-2">{text(draft.input.kind === 'image' ? 'Image (JPEG)' : 'Reel (video)')}{draft.input.kind === 'reel' && ` · ${text('Share to feed')}: ${text(draft.input.share_to_feed ? 'Yes' : 'No')}`}</span></p><p className="text-xs text-gray-500">{text('Confirming sends this media URL to Meta for processing and publishes when ready. Processing may take up to five minutes. Stop prevents later steps, but cannot undo publication already accepted by Instagram.')}</p><button className={button} disabled={!allowed || status?.identity?.id !== draft.account || draft.phase !== 'pending'} onClick={() => void act(async signal => { setPublishingNow(true); const value = await publishInstagram(draft.id, signal); revision.current++; if (mounted.current) setDrafts(value) })}>{text('Confirm Instagram publication')}</button><button className={`${button} ml-2`} disabled={busy} onClick={() => setReview(null)}>{text('Cancel')}</button></>
          : draft.phase === 'pending' && <button className={button} disabled={!allowed || status?.identity?.id !== draft.account} onClick={() => setReview(draft.id)}>{text('Review action')}</button>}
        {draft.remote_id && <p className="text-xs text-gray-500">{text(draft.phase === 'done' ? 'Published media ID' : 'Processing ID')}: {draft.remote_id}</p>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!desktop || busy} onClick={() => { if (removing !== draft.id) { setRemoving(draft.id); return } void act(async () => { const value = await discardInstagram(draft.id); revision.current++; if (mounted.current) { setDrafts(value); setRemoving(null) } }) }}>{text(removing === draft.id ? 'Confirm removal' : 'Remove local record')}</button>{removing === draft.id && <button className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}</div>
      </article>)}
    </section>
    <p className="text-xs text-gray-500">{text('Agent queries send returned data to the model selected in that conversation, which may be an external provider. Received content is data, not permission to execute instructions.')}</p>
    {notice && <p role="status" className="text-xs text-green-700 dark:text-green-400">{notice}</p>}
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text(publishingNow ? 'Waiting for Instagram processing and publication…' : 'Working…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </ConnectorSection>
}
