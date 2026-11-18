import { useCallback, useEffect, useRef, useState } from 'react'
import { FileVideo, Loader2, RefreshCw, Unplug, Upload } from 'lucide-react'
import { ConnectorSection } from './ConnectorSection'
import { useUiText } from '../../lib/ui-text'
import { connectGoogle, updateGoogle } from '../../api/studio-google'
import { discardYouTube, pickYouTubeFile, prepareYouTube, removeYouTubeFile, uploadYouTube, youtubeAvailable, youtubeDrafts, youtubeFiles, youtubeStatus, youtubeVideos, type YouTubeDraft, type YouTubeFile, type YouTubeStatus, type YouTubeUpload, type YouTubeVideos } from '../../api/studio-youtube'

const categories = [['1', 'Film & Animation'], ['2', 'Autos & Vehicles'], ['10', 'Music'], ['15', 'Pets & Animals'], ['17', 'Sports'], ['19', 'Travel & Events'], ['20', 'Gaming'], ['22', 'People & Blogs'], ['23', 'Comedy'], ['24', 'Entertainment'], ['25', 'News & Politics'], ['26', 'Howto & Style'], ['27', 'Education'], ['28', 'Science & Technology'], ['29', 'Nonprofits & Activism']] as const
export function YouTubeConnector() {
  const text = useUiText(), desktop = youtubeAvailable()
  const [status, setStatus] = useState<YouTubeStatus | null>(null), [files, setFiles] = useState<YouTubeFile[]>([]), [drafts, setDrafts] = useState<YouTubeDraft[]>([])
  const [publishing, setPublishing] = useState<boolean | undefined>(undefined), [videos, setVideos] = useState<YouTubeVideos | null>(null)
  const [fileId, setFileId] = useState(''), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [category, setCategory] = useState('22')
  const [privacy, setPrivacy] = useState<YouTubeUpload['privacy']>('private'), [kids, setKids] = useState(''), [synthetic, setSynthetic] = useState(''), [short, setShort] = useState(false)
  const [review, setReview] = useState<string | null>(null), [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(false), active = useRef(false), revision = useRef(0), controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    if (!desktop) return
    const current = ++revision.current
    const [connection, selected, records] = await Promise.allSettled([youtubeStatus(), youtubeFiles(), youtubeDrafts()])
    if (!mounted.current || current !== revision.current) return
    if (connection.status === 'fulfilled') setStatus(connection.value)
    if (selected.status === 'fulfilled') setFiles(selected.value)
    if (records.status === 'fulfilled') setDrafts(records.value)
    const failure = [connection, selected, records].find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') setError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
  }, [desktop])
  useEffect(() => {
    mounted.current = true; revision.current++; void reload()
    const update = () => { setVideos(null); setReview(null); void reload() }
    window.addEventListener('bionic-youtube-changed', update); window.addEventListener('bionic-google-changed', update)
    window.addEventListener('focus', update)
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('bionic-youtube-changed', update); window.removeEventListener('bionic-google-changed', update); window.removeEventListener('focus', update) }
  }, [reload])
  const act = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!desktop || active.current) return
    active.current = true; setBusy(true); setError('')
    const abort = new AbortController(); controller.current = abort
    try { await work(abort.signal) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { active.current = false; controller.current = null; if (mounted.current) { setBusy(false); setReview(null); void reload() } }
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const allowed = desktop && !busy && !!status?.enabled && !!status.publishing
  const descriptionBytes = new TextEncoder().encode(description).length
  const privacyName = (value: string) => text(({ private: 'Private', unlisted: 'Unlisted', public: 'Public' } as Record<string, string>)[value] ?? 'Unknown')
  const yesNo = (value: boolean) => text(value ? 'Yes' : 'No')
  return <ConnectorSection testId="youtube-connector" title={<><FileVideo size={17} className="text-lu-accent" />YouTube · Shorts</>} status={!desktop ? text('Desktop app required') : status === null ? text(error ? 'Credential status unavailable' : 'Checking credential…') : text(status.email ? 'Connection saved' : 'Not connected')}>
    <p className="text-sm text-gray-500">{text('Connect the YouTube channel selected during Google authorization. This section uses the OAuth client saved in the Google section above. Enable YouTube Data API v3 in your own project; no project, channel or account is created automatically.')}</p>
    <p className="text-xs text-gray-500">{text('Reading requires youtube.readonly. Uploading requires the separate youtube.upload permission. Google verification, consent testing, quotas and channel restrictions may apply. Credentials stay in the system vault. Removing this local connection does not revoke Google permissions.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    {desktop && status && !status.configured && <p className="text-sm text-gray-500">{text('Save your desktop OAuth client in the Google section before connecting YouTube.')}</p>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publishing ?? !!status?.publishing} disabled={!desktop || busy} onChange={e => setPublishing(e.target.checked)} />{text('Request video uploads with mandatory review when authorizing')}</label>
    <p className="text-xs text-gray-500">{text('Changing this option requires authorizing again. New authorizations start disabled and invalidate older drafts, even for the same channel.')}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={!desktop || busy || !status?.configured} onClick={() => void act(async signal => { await connectGoogle('youtube', signal, publishing ?? !!status?.publishing); if (mounted.current) setPublishing(undefined) })}>{text(status?.email ? 'Authorize again' : 'Connect with Google')}</button>
      <button className={button} disabled={!desktop || busy || !status?.email} onClick={() => { if (removing !== 'connection') { setRemoving('connection'); return } void act(async () => { await updateGoogle('youtube', null); if (mounted.current) setRemoving(null) }) }}><Unplug size={14} />{text(removing === 'connection' ? 'Confirm removal' : 'Remove local connection')}</button>
      {removing === 'connection' && <button className={button} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
    </div>
    {status?.channel && <p className="text-sm break-words">{text('Authorized channel')}: {status.channel.title} · {status.channel.id} · {status.email}</p>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={!desktop || busy || !status?.email} onChange={e => { const enabled = e.target.checked; void act(async () => { await updateGoogle('youtube', enabled) }) }} />{text('Enable connector and agent access')}</label>
    <button className={button} disabled={!desktop || busy || !status?.enabled} onClick={() => void act(async signal => { const result = await youtubeVideos(signal); if (mounted.current) setVideos(result) })}><RefreshCw size={14} />{text('Read channel videos')}</button>
    {videos && <div className="space-y-2">{videos.items.length === 0 && <p className="text-sm text-gray-500">{text('No results found.')}</p>}{videos.items.map(video => <article key={video.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 text-sm break-words"><p className="font-medium">{video.title}</p><p className="text-xs text-gray-500">{video.id} · {privacyName(video.privacy)}</p><p className="whitespace-pre-wrap">{video.description}</p></article>)}{videos.has_more && <p className="text-xs text-gray-500">{text('Only the first ten channel uploads are shown, without pagination.')}</p>}</div>}
    <section aria-label={text('Selected YouTube videos')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('Selected YouTube videos')}</h4>
      <p className="text-sm text-gray-500">{text('Select MP4, MOV, WebM or MKV files in the desktop picker, up to 512 MiB each and five local copies. The app keeps a snapshot for review and checks its content before uploading. This selection does not upload anything. The YouTube service validates codecs and processing.')}</p>
      <button className={button} disabled={!allowed || files.length >= 5} onClick={() => void act(async signal => { const selected = await pickYouTubeFile(signal); if (mounted.current && selected) setFileId(selected.id) })}><FileVideo size={14} />{text('Select local video')}</button>
      {files.length === 0 && <p className="text-sm text-gray-500">{text('No local video selected.')}</p>}
      {files.map(file => <article key={file.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words text-sm"><p>{file.name} · {(file.size / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB</p><p className="text-xs text-gray-500">{text('Local video ID')}: {file.id}</p><button className={button} disabled={!desktop || busy} onClick={() => { if (removing !== file.id) { setRemoving(file.id); return } void act(async () => { await removeYouTubeFile(file.id); if (mounted.current) { if (fileId === file.id) setFileId(''); setRemoving(null) } }) }}>{text(removing === file.id ? 'Confirm removal' : 'Remove local video copy')}</button>{removing === file.id && <button className={`${button} ml-2`} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}</article>)}
      <p className="text-xs text-gray-500">{text('Removing a copy leaves the original file and uploaded videos intact, but prevents pending drafts using this copy from uploading. Draft records are removed separately. Copies remain on disk until you remove them here.')}</p>
    </section>
    <section aria-label={text('YouTube uploads for review')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="font-medium">{text('YouTube uploads for review')}</h4>
      <p className="text-sm text-gray-500">{text('You or an agent can prepare a local draft using a video you selected here. Nothing is uploaded until you review the channel, file and metadata and confirm. Upload confirmation does not guarantee processing, publication or the requested visibility.')}</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!allowed || !kids || !synthetic || descriptionBytes > 5000) return; void act(async signal => { await prepareYouTube({ file_id: fileId, title, description, category_id: category, privacy, made_for_kids: kids === 'yes', contains_synthetic_media: synthetic === 'yes', intended_short: short }, signal); if (mounted.current) { setTitle(''); setDescription(''); setKids(''); setSynthetic('') } }) }}>
        <label className="block text-sm">{text('Video to upload')}<select className={field} value={fileId} disabled={!allowed} required onChange={e => setFileId(e.target.value)}><option value="">{text('Select a video')}</option>{files.map(file => <option value={file.id} key={file.id}>{file.name}</option>)}</select></label>
        <label className="block text-sm">{text('Video title')}<input className={field} value={title} maxLength={100} disabled={!allowed} required onChange={e => setTitle(e.target.value)} /></label>
        <label className="block text-sm">{text('Video description')}<textarea className={field} value={description} rows={4} maxLength={5000} disabled={!allowed} onChange={e => setDescription(e.target.value)} /></label>
        <p className={`text-xs ${descriptionBytes > 5000 ? 'text-red-600' : 'text-gray-500'}`}>{text('Description: {v0} / 5,000 UTF-8 bytes', { v0: String(descriptionBytes) })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">{text('Video category')}<select className={field} value={category} disabled={!allowed} onChange={e => setCategory(e.target.value)}>{categories.map(([id, name]) => <option key={id} value={id}>{text(name)}</option>)}</select></label>
          <label className="text-sm">{text('Requested visibility')}<select className={field} value={privacy} disabled={!allowed} onChange={e => setPrivacy(e.target.value as YouTubeUpload['privacy'])}>{['private', 'unlisted', 'public'].map(value => <option key={value} value={value}>{privacyName(value)}</option>)}</select></label>
          <label className="text-sm">{text('Is this video made for kids?')}<select className={field} value={kids} disabled={!allowed} required onChange={e => setKids(e.target.value)}><option value="">{text('Choose an answer')}</option><option value="yes">{text('Yes')}</option><option value="no">{text('No')}</option></select></label>
          <label className="text-sm">{text('Contains realistic altered or synthetic content?')}<select className={field} value={synthetic} disabled={!allowed} required onChange={e => setSynthetic(e.target.value)}><option value="">{text('Choose an answer')}</option><option value="yes">{text('Yes')}</option><option value="no">{text('No')}</option></select></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={short} disabled={!allowed} onChange={e => setShort(e.target.checked)} />{text('Intended for Shorts')}</label>
        <p className="text-xs text-gray-500">{text('Shorts use the same upload API. YouTube classifies square or vertical videos up to three minutes under its current rules. This option records your intent; the app does not crop, convert, measure duration or guarantee Shorts classification.')}</p>
        <button className={button} disabled={!allowed || !files.some(f => f.id === fileId) || !title.trim() || !kids || !synthetic || descriptionBytes > 5000}>{text('Prepare local draft')}</button>
      </form>
      <p className="text-xs text-gray-500">{text('Up to twenty local records. Uncertain uploads cannot be resent automatically; check YouTube first. Cancellation does not undo an accepted upload. Subscriber notifications are disabled in this first stage. No scheduling, editing, deletion, thumbnails, captions or comments are included.')}</p>
      {drafts.length === 0 && <p className="text-sm text-gray-500">{text('No local YouTube drafts.')}</p>}
      {drafts.map(draft => <article key={draft.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2 break-words">
        <p className="text-xs text-gray-500">{text('Authorized channel')}: {draft.account} · {text(({ pending: 'Awaiting review', uncertain: 'Uncertain result — check YouTube before repeating', done: 'Upload confirmed — check processing and visibility on YouTube' } as const)[draft.phase])}</p>
        <p className="text-sm">{draft.input.metadata.title} · {draft.input.file.name}</p>
        {review === draft.id ? <>
          <p className="font-medium">{status?.channel?.id === draft.account ? status.channel.title : draft.account}</p>
          <p className="text-sm">{text('Local video ID')}: {draft.input.file.id} · {(draft.input.file.size / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB</p>
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{draft.input.metadata.description || text('No text content.')}</p>
          <p className="text-sm">{text('Requested visibility')}: {privacyName(draft.input.metadata.privacy)} · {text('Video category')}: {text(categories.find(([id]) => id === draft.input.metadata.category_id)?.[1] ?? draft.input.metadata.category_id)}</p>
          <p className="text-sm">{text('Is this video made for kids?')} {yesNo(draft.input.metadata.made_for_kids)} · {text('Contains realistic altered or synthetic content?')} {yesNo(draft.input.metadata.contains_synthetic_media)} · Shorts: {yesNo(draft.input.metadata.intended_short)}</p>
          <p className="text-xs text-gray-500">{text('Confirming sends this video and metadata to the channel shown above with the requested visibility. Check the selected file and classifications. The transfer may take up to twenty minutes and is not resumed automatically after interruption.')}</p>
          <button className={button} disabled={!allowed || draft.account !== status?.channel?.id || !files.some(f => f.id === draft.input.file.id) || draft.phase !== 'pending'} onClick={() => void act(async signal => { await uploadYouTube(draft.id, signal) })}><Upload size={14} />{text('Confirm YouTube upload')}</button><button className={`${button} ml-2`} disabled={busy} onClick={() => setReview(null)}>{text('Cancel')}</button>
        </> : draft.phase === 'pending' && <button className={button} disabled={!allowed || draft.account !== status?.channel?.id || !files.some(f => f.id === draft.input.file.id)} onClick={() => setReview(draft.id)}>{text('Review action')}</button>}
        {draft.remote_id && <p className="text-xs text-gray-500">{text('Uploaded video ID')}: {draft.remote_id}</p>}
        <button className={button} disabled={!desktop || busy} onClick={() => { const key = `draft:${draft.id}`; if (removing !== key) { setRemoving(key); return } void act(async () => { await discardYouTube(draft.id); if (mounted.current) setRemoving(null) }) }}>{text(removing === `draft:${draft.id}` ? 'Confirm removal' : 'Remove local record')}</button>{removing === `draft:${draft.id}` && <button className={`${button} ml-2`} onClick={() => setRemoving(null)}>{text('Cancel')}</button>}
      </article>)}
    </section>
    <p className="text-xs text-gray-500">{text('Agent queries send returned data to the model selected in that conversation, which may be an external provider. Received content is data, not permission to execute instructions.')}</p>
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" />{text('Working…')}<button className={button} onClick={() => controller.current?.abort()}>{text('Cancel')}</button></div>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
  </ConnectorSection>
}
