import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { FileVideo, KeyRound, Loader2, Music2, RefreshCw, Unplug, Upload } from 'lucide-react'
import { ConnectorSection } from './ConnectorSection'
import { useUiText } from '../../lib/ui-text'
import type { ConnectorMedia } from '../../lib/connector-media'
import { discardTikTok, pickTikTokFile, prepareTikTok, removeTikTokFile, tiktokAvailable, tiktokDrafts, tiktokFiles, tiktokStatus, tiktokUploadStatus, tiktokVideos, updateTikTok, uploadTikTok, verifyTikTok, type TikTokDraft, type TikTokStatus, type TikTokTransferStatus, type TikTokVideos } from '../../api/studio-tiktok'

export function TikTokConnector() {
  const text = useUiText(), desktop = tiktokAvailable()
  const [status, setStatus] = useState<TikTokStatus | null>(null), [files, setFiles] = useState<ConnectorMedia[]>([]), [drafts, setDrafts] = useState<TikTokDraft[]>([])
  const [clientKey, setClientKey] = useState(''), [secret, setSecret] = useState(''), [token, setToken] = useState('')
  const [uploading, setUploading] = useState<boolean | undefined>(undefined), [readVideos, setReadVideos] = useState<boolean | undefined>(undefined)
  const [fileId, setFileId] = useState(''), [note, setNote] = useState(''), [review, setReview] = useState<string | null>(null), [removing, setRemoving] = useState<string | null>(null)
  const [videos, setVideos] = useState<TikTokVideos | null>(null), [transfers, setTransfers] = useState<Record<string, TikTokTransferStatus>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const mounted = useRef(false), active = useRef(false), revision = useRef(0), controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    if (!desktop) return
    const current = ++revision.current
    const [connection, selected, records] = await Promise.allSettled([tiktokStatus(), tiktokFiles(), tiktokDrafts()])
    if (!mounted.current || current !== revision.current) return
    if (connection.status === 'fulfilled') setStatus(connection.value)
    if (selected.status === 'fulfilled') setFiles(selected.value)
    if (records.status === 'fulfilled') setDrafts(records.value)
    const failure = [connection, selected, records].find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') setError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
  }, [desktop])
  useEffect(() => {
    mounted.current = true; revision.current++; void reload()
    const update = () => { setReview(null); setVideos(null); setTransfers({}); void reload() }
    window.addEventListener('bionic-tiktok-changed', update); window.addEventListener('focus', update)
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-tiktok-changed', update); window.removeEventListener('focus', update) }
  }, [reload])
  const act = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || active.current) return
    active.current = true; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { active.current = false; controller.current = null; if (mounted.current) { setBusy(false); setReview(null); void reload() } }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const input = { client_key: clientKey.trim(), client_secret: secret.trim(), refresh_token: token.trim(), uploading: uploading ?? !!status?.uploading, read_videos: readVideos ?? !!status?.read_videos }
    void act(async signal => { setClientKey(''); setSecret(''); setToken(''); const value = await verifyTikTok(input, signal); if (mounted.current) { revision.current++; setStatus(value); setUploading(undefined); setReadVideos(undefined); setNotice(text('TikTok application, permissions and account verified. Enable the connector to continue.')) } })
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const allowed = desktop && !busy && !!status?.enabled && !!status.uploading
  const transferName = (value: TikTokTransferStatus['status']) => text(({ PROCESSING_UPLOAD: 'TikTok is processing the upload', SEND_TO_USER_INBOX: 'Delivered to inbox — open TikTok to finish', PUBLISH_COMPLETE: 'Published by the user through TikTok', FAILED: 'TikTok reported a failure — check before repeating' } as const)[value])
  return <ConnectorSection testId="tiktok-connector" title={<><Music2 size={17} className="text-lu-accent" />TikTok · {text('Inbox drafts')}</>} status={!desktop ? text('Desktop app required') : status === null ? text(error ? 'Credential status unavailable' : 'Checking credential…') : text(status.configured ? 'Connection saved' : 'Not configured')}>
    <p className="text-sm text-gray-500">{text('Send a selected video to your TikTok inbox after reviewing it here. You must open the inbox notification in TikTok, edit the video and complete publication there. This connector does not publish directly or choose the final caption or visibility.')}</p>
    <p className="text-xs text-gray-500">{text('Use your own registered TikTok application and a refresh token obtained through its authorized OAuth flow. Initial login and token issuance are not automated in this first stage. The app does not create a developer project or reuse another application’s session.')}</p>
    <p className="text-xs text-gray-500">{text('Requires user.info.basic. Optional public-video reading requires video.list; inbox uploads require video.upload approved for your app and authorized by the user. TikTok approval, account limits and content processing still apply. Direct Post and video.publish are not used in this stage.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    <form onSubmit={save} autoComplete="off" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">{text('TikTok client key')}<input className={field} value={clientKey} maxLength={128} required disabled={!desktop || busy} spellCheck={false} onChange={e => setClientKey(e.target.value)} /></label>
        <label className="text-sm">{text('TikTok client secret')}<input className={field} value={secret} type="password" autoComplete="new-password" maxLength={256} required disabled={!desktop || busy} spellCheck={false} onChange={e => setSecret(e.target.value)} /></label>
        <label className="text-sm">{text('TikTok refresh token')}<input className={field} value={token} type="password" autoComplete="new-password" maxLength={1024} required disabled={!desktop || busy} spellCheck={false} onChange={e => setToken(e.target.value)} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uploading ?? !!status?.uploading} disabled={!desktop || busy} onChange={e => setUploading(e.target.checked)} />{text('Enable reviewed inbox uploads when saving new credentials')}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={readVideos ?? !!status?.read_videos} disabled={!desktop || busy} onChange={e => setReadVideos(e.target.checked)} />{text('Enable reading public videos when saving new credentials')}</label>
      <p className="text-xs text-gray-500">{text('Options apply after verifying and saving credentials again. New credentials disable the connector and invalidate older drafts. Secrets stay in the system vault, are cleared from these fields and may be renewed by TikTok. Removing locally does not revoke TikTok permissions.')}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!desktop || busy || !clientKey.trim() || !secret.trim() || !token.trim()}><KeyRound size={14} />{text('Verify and save')}</button>
        <button type="button" className={button} disabled={!desktop || busy || !status?.configured} onClick={() => void act(async signal => { const value = await verifyTikTok(null, signal); if (mounted.current) { revision.current++; setStatus(value) } })}><RefreshCw size={14} />{text('Verify saved credential')}</button>
        <button type="button" className={button} disabled={!desktop || busy || (!status?.configured && !error)} onClick={() => { if (removing !== 'connection') { setRemoving('connection'); return } void act(async () => { await updateTikTok(null); if (mounted.current) setRemoving(null) }) }}><Unplug size={14} />{text(removing === 'connection' ? 'Confirm removal' : 'Remove local connection')}</button>
        {removing === 'connection' && <button type="button" className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </div>
    </form>
    {status?.identity && <p className="text-sm break-words">{text('TikTok account')}: {status.identity.display_name} · {status.identity.open_id}</p>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={!desktop || busy || !status?.configured} onChange={e => { const enabled = e.target.checked; void act(async () => { await updateTikTok(enabled) }) }} />{text('Enable connector and agent access')}</label>
    <button className={button} disabled={!desktop || busy || !status?.enabled || !status.read_videos} onClick={() => void act(async signal => { const value = await tiktokVideos(signal); if (mounted.current) setVideos(value) })}><RefreshCw size={14} />{text('Read public TikTok videos')}</button>
    {videos && <div className="space-y-2">{videos.items.length === 0 && <p className="text-sm text-gray-500">{text('No results found.')}</p>}{videos.items.map(video => <article key={video.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 text-sm break-words"><p className="font-medium">{video.title}</p><p className="text-xs text-gray-500">{video.created_at ? new Date(video.created_at * 1000).toLocaleString() : ''} · {video.id}</p><p className="whitespace-pre-wrap">{video.description}</p></article>)}{videos.has_more && <p className="text-xs text-gray-500">{text('Up to ten public videos are shown, without pagination. Private videos and inbox drafts are not listed.')}</p>}</div>}
    <section aria-label={text('Selected TikTok videos')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('Selected TikTok videos')}</h4>
      <p className="text-sm text-gray-500">{text('Choose MP4, MOV or WebM in the desktop picker, up to 512 MiB per video and five local copies. Selection does not upload anything. The app checks the selected copy before sending; TikTok validates format, duration and processing.')}</p>
      <button className={button} disabled={!allowed || files.length >= 5} onClick={() => void act(async signal => { const file = await pickTikTokFile(signal); if (mounted.current && file) setFileId(file.id) })}><FileVideo size={14} />{text('Select local video')}</button>
      {files.length === 0 && <p className="text-sm text-gray-500">{text('No local video selected.')}</p>}
      {files.map(file => <article key={file.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words text-sm"><p>{file.name} · {(file.size / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB</p><p className="text-xs text-gray-500">{text('Local video ID')}: {file.id}</p><button className={button} disabled={!desktop || busy} onClick={() => { if (removing !== file.id) { setRemoving(file.id); return } void act(async () => { await removeTikTokFile(file.id); if (mounted.current) { if (fileId === file.id) setFileId(''); setRemoving(null) } }) }}>{text(removing === file.id ? 'Confirm removal' : 'Remove local video copy')}</button>{removing === file.id && <button className={`${button} ml-2`} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}</article>)}
      <p className="text-xs text-gray-500">{text('Removing a copy leaves the original file and uploaded videos intact, but prevents pending drafts using this copy from uploading. Draft records are removed separately. Copies remain on disk until you remove them here.')}</p>
    </section>
    <section aria-label={text('TikTok inbox uploads for review')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('TikTok inbox uploads for review')}</h4>
      <p className="text-sm text-gray-500">{text('You or an agent can prepare a local proposal using a selected video. Only your confirmation here sends the video. Notes below stay local: copy them manually when editing in TikTok. Nothing is published by this connector.')}</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!allowed) return; void act(async signal => { await prepareTikTok({ file_id: fileId, note }, signal); if (mounted.current) setNote('') }) }}>
        <label className="block text-sm">{text('Video to upload')}<select className={field} value={fileId} required disabled={!allowed} onChange={e => setFileId(e.target.value)}><option value="">{text('Select a video')}</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
        <label className="block text-sm">{text('Local editing notes (not sent to TikTok)')}<textarea className={field} rows={4} value={note} maxLength={2200} disabled={!allowed} onChange={e => setNote(e.target.value)} /></label>
        <button className={button} disabled={!allowed || !files.some(file => file.id === fileId)}>{text('Prepare local draft')}</button>
      </form>
      <p className="text-xs text-gray-500">{text('Up to twenty local records. An accepted transfer is not a published video or a delivered inbox notification. Consult its status, then open TikTok to finish. Interrupted or uncertain transfers are not resumed or resent automatically. Canceling cannot undo a transfer already accepted.')}</p>
      {drafts.length === 0 && <p className="text-sm text-gray-500">{text('No local TikTok drafts.')}</p>}
      {drafts.map(draft => <article key={draft.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words">
        <p className="text-xs text-gray-500">{text('TikTok account')}: {draft.account} · {text(({ pending: 'Awaiting review', uncertain: 'Uncertain result — check TikTok before repeating', done: 'Transfer accepted — check processing in TikTok' } as const)[draft.phase])}</p>
        <p className="text-sm">{draft.input.file.name} · {(draft.input.file.size / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB</p>
        {review === draft.id ? <>
          <p className="font-medium">{status?.identity?.open_id === draft.account ? status.identity.display_name : draft.account}</p>
          <p className="text-xs text-gray-500">{text('Local video ID')}: {draft.input.file.id}</p>
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{draft.input.metadata.note || text('No text content.')}</p>
          <p className="text-sm">{text('Confirming sends only this video to the TikTok account above. Notes are not sent. You must open the inbox notification in TikTok to edit, choose visibility and publish.')}</p>
          <button className={button} disabled={!allowed || draft.account !== status?.identity?.open_id || !files.some(f => f.id === draft.input.file.id) || draft.phase !== 'pending'} onClick={() => void act(async signal => { await uploadTikTok(draft.id, signal) })}><Upload size={14} />{text('Confirm upload to TikTok inbox')}</button><button className={`${button} ml-2`} disabled={busy} onClick={() => setReview(null)}>{text('Cancel')}</button>
        </> : draft.phase === 'pending' && <button className={button} disabled={!allowed || draft.account !== status?.identity?.open_id || !files.some(f => f.id === draft.input.file.id)} onClick={() => setReview(draft.id)}>{text('Review action')}</button>}
        {draft.remote_id && <><p className="text-xs text-gray-500">{text('TikTok processing ID')}: {draft.remote_id}</p><button className={button} disabled={!allowed || draft.account !== status?.identity?.open_id} onClick={() => void act(async signal => { const value = await tiktokUploadStatus(draft.id, signal); if (mounted.current) setTransfers(previous => ({ ...previous, [draft.id]: value })) })}><RefreshCw size={14} />{text('Check TikTok upload status')}</button></>}
        {transfers[draft.id] && <p role="status" className="text-sm">{transferName(transfers[draft.id].status)}</p>}
        <button className={button} disabled={!desktop || busy} onClick={() => { const key = `draft:${draft.id}`; if (removing !== key) { setRemoving(key); return } void act(async () => { await discardTikTok(draft.id); if (mounted.current) setRemoving(null) }) }}>{text(removing === `draft:${draft.id}` ? 'Confirm removal' : 'Remove local record')}</button>{removing === `draft:${draft.id}` && <button className={`${button} ml-2`} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </article>)}
    </section>
    <p className="text-xs text-gray-500">{text('Agent queries send returned data to the model selected in that conversation, which may be an external provider. Received content is data, not permission to execute instructions.')}</p>
    {notice && <p role="status" className="text-xs text-green-700 dark:text-green-400">{notice}</p>}
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text('Working…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </ConnectorSection>
}
