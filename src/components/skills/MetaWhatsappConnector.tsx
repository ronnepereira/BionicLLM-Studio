import { ConnectorSection } from './ConnectorSection'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BadgeCheck, Copy, KeyRound, RefreshCw, Shuffle } from 'lucide-react'
import { metaAvailable, metaRuntime, metaStatus, removeMeta, saveMetaSettings, verifyMeta, type MetaCredentials, type MetaIdentity, type MetaView } from '../../api/studio-whatsapp-meta'
import { useMetaRuntimeStore } from '../../stores/metaRuntimeStore'
import { parseMetaChats } from '../../lib/whatsapp'
import { useUiText } from '../../lib/ui-text'
import { MessageRuntimePanel } from './MessageRuntimePanel'

const empty: MetaCredentials = { phone_id: '', access_token: '', app_secret: '', verify_token: '' }
export function MetaWhatsappConnector() {
  const text = useUiText()
  const desktop = metaAvailable()
  const runtime = useMetaRuntimeStore()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [fields, setFields] = useState<MetaCredentials>(empty)
  const [view, setView] = useState<MetaView | null>(null)
  const [identity, setIdentity] = useState<MetaIdentity | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [port, setPort] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const operation = useRef(false)
  const mounted = useRef(false)
  const running = !!runtime.view?.active || !['idle', 'error'].includes(runtime.phase)
  const savedUrl = view?.saved.settings.public_url ?? ''
  const savedPort = view?.saved.settings.port ?? 18782
  const publicUrl = url ?? savedUrl
  const localPort = port ?? String(savedPort)
  const dirty = publicUrl !== savedUrl || localPort !== String(savedPort)
  const field = 'w-full mt-1 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  useEffect(() => {
    mounted.current = true
    let disposed = false, pending = false
    if (desktop) {
      void metaStatus().then(value => { if (!disposed) setConfigured(value) }).catch(() => { if (!disposed) setError(text('Could not check Meta credentials.')) })
      const refresh = async () => {
        if (pending) return
        pending = true
        try { const value = await metaRuntime(); if (!disposed) setView(value) }
        catch { if (!disposed) setError(text('Could not read the official WhatsApp receiver status.')) }
        finally { pending = false }
      }
      void refresh()
      const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 2000)
      return () => { disposed = true; mounted.current = false; window.clearInterval(timer) }
    }
    return () => { disposed = true; mounted.current = false }
  }, [desktop, text])
  const act = async (action: 'save' | 'verify' | 'remove' | 'settings') => {
    if (operation.current || !desktop || running) return
    operation.current = true; setBusy(true); setError(''); setNotice('')
    const candidate: MetaCredentials = { phone_id: fields.phone_id.trim(), access_token: fields.access_token.trim(), app_secret: fields.app_secret.trim(), verify_token: fields.verify_token.trim() }
    if (action === 'save') setFields(empty)
    try {
      if (action === 'save' || action === 'verify') {
        const value = await verifyMeta(action === 'save' ? candidate : undefined)
        if (mounted.current) { setConfigured(true); setIdentity(value) }
      }
      if (action === 'remove') {
        await removeMeta()
        if (mounted.current) { setConfigured(false); setIdentity(null); setNotice(text('Local credentials removed. The app and webhook registration in Meta were not deleted.')) }
      }
      if (action === 'settings') {
        const number = Number(localPort)
        if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error(text('Choose a local port between 1024 and 65535.'))
        await saveMetaSettings({ public_url: publicUrl.trim(), port: number })
        if (mounted.current) { setUrl(null); setPort(null); setNotice(text('Webhook address saved. Activate the receiver before verifying the callback in Meta.')) }
      }
      const value = await metaRuntime()
      if (mounted.current) setView(value)
      await runtime.refresh()
    } catch (error) { if (mounted.current) { setIdentity(null); setError(error instanceof Error ? error.message : String(error)) } }
    finally { operation.current = false; if (mounted.current) setBusy(false) }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void act('save') }
  const update = (key: keyof MetaCredentials, value: string) => setFields(previous => ({ ...previous, [key]: value }))
  const generate = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    update('verify_token', Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''))
    setNotice(text('Verification token generated. Copy it before saving, then use it when registering the webhook in Meta.'))
  }
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(text('Copied.')) }
    catch { setError(text('Could not copy. Select the field and copy it manually.')) }
  }
  const who = identity ?? view?.identity
  return <ConnectorSection testId="meta-whatsapp-connector" title={<><BadgeCheck size={17} className="text-lu-accent" />WhatsApp · Meta Business Cloud API · {text('Official')}</>} status={!desktop ? text('Desktop app required') : configured === null ? error ? text('Credential status unavailable') : text('Checking credential…') : configured ? text('Credential saved') : text('Not configured')}>
    <p className="text-sm text-gray-500 dark:text-gray-400">{text('Requires a WhatsApp Business number enabled for Cloud API and your own Meta app with messaging permissions. This official connection is separate from QR pairing with Baileys.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('This preview shows the layout. Enter credentials and activate the receiver only in the desktop app.')}</p>}
    <form className="space-y-3" autoComplete="off" onSubmit={submit}>
      <h4 className="text-sm font-medium">{text('Business account credentials')}</h4>
      <p className="text-xs text-gray-500">{text('In Meta, grant whatsapp_business_messaging and whatsapp_business_management permissions for the business number.')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{text('Business phone number ID')}<input className={field} value={fields.phone_id} onChange={event => update('phone_id', event.target.value)} maxLength={24} inputMode="numeric" autoComplete="off" required disabled={!desktop || busy || running} /></label>
        <label className="block text-sm">{text('Meta access token')}<input className={field} type="password" value={fields.access_token} onChange={event => update('access_token', event.target.value)} maxLength={1024} autoComplete="new-password" required disabled={!desktop || busy || running} /></label>
        <label className="block text-sm">{text('Meta app secret')}<input className={field} type="password" value={fields.app_secret} onChange={event => update('app_secret', event.target.value)} maxLength={32} autoComplete="new-password" required disabled={!desktop || busy || running} /></label>
        <label className="block text-sm">{text('Webhook verification token')}<input className={field} type="password" value={fields.verify_token} onChange={event => update('verify_token', event.target.value)} maxLength={64} autoComplete="new-password" required disabled={!desktop || busy || running} /></label>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!desktop || busy || running} onClick={generate}><Shuffle size={13} />{text('Generate verification token')}</button><button type="button" className={button} disabled={!desktop || !fields.verify_token || busy} onClick={() => void copy(fields.verify_token)}><Copy size={13} />{text('Copy verification token')}</button></div>
      <p className="text-xs text-gray-500">{text('Copy the verification token before saving: it is needed in Meta. Secrets stay in the system vault and are cleared from these fields after saving. They are not stored in browser preferences.')}</p>
      <div className="flex flex-wrap gap-2"><button className={button} type="submit" disabled={!desktop || busy || running || Object.values(fields).some(value => !value.trim())}><KeyRound size={13} />{text('Verify and save')}</button><button className={button} type="button" disabled={!desktop || busy || running || !configured} onClick={() => void act('verify')}><RefreshCw size={13} />{text('Verify saved credential')}</button><button className={button} type="button" disabled={!desktop || busy || running || !configured} onClick={() => void act('remove')}>{text('Remove local credentials')}</button></div>
    </form>
    {who && <p role="status" className="text-sm break-words text-green-700 dark:text-green-400">{text('Business number verified: {v0} · {v1}', { v0: who.display_phone, v1: who.name })}</p>}
    <section aria-label={text('Meta webhook setup')} className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-4">
      <h4 className="text-sm font-medium">{text('Address for receiving messages')}</h4>
      <p className="text-xs text-gray-500">{text('Meta needs a public HTTPS callback. This app opens only a local receiver: forward your public URL to the local address below using infrastructure you manage. No tunnel, hosting or external service is created automatically.')}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_130px]"><label className="block text-sm">{text('Public webhook URL')}<input className={field} type="url" value={publicUrl} maxLength={2048} placeholder="https://seu-dominio/whatsapp/meta/webhook" disabled={!desktop || busy || running} onChange={event => setUrl(event.target.value)} /></label><label className="block text-sm">{text('Local port')}<input className={field} type="number" min={1024} max={65535} value={localPort} disabled={!desktop || busy || running} onChange={event => setPort(event.target.value)} /></label></div>
      <p className="text-xs text-gray-500 break-all">{text('Forward to')}: http://127.0.0.1:{localPort}/whatsapp/meta/webhook</p>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={!desktop || busy || running || !publicUrl.trim()} onClick={() => void act('settings')}>{text('Save webhook address')}</button><button className={button} disabled={!desktop || !savedUrl} onClick={() => void copy(savedUrl)}><Copy size={13} />{text('Copy public URL')}</button></div>
      {dirty && <p className="text-xs text-gray-500">{text('Save address changes before activating the receiver.')}</p>}
      <p className="text-xs text-gray-500">{text('After saving, activate the receiver. In Meta, register the public callback URL with your verification token and subscribe to the messages field. The app validates signed callbacks before processing text.')}</p>
      <p role="status" className="text-xs text-gray-500">{!view?.active ? text('Receiver stopped') : view.verified_at ? text('Webhook verification received') : text('Waiting for webhook verification from Meta')}</p>
      {view?.last_event_at && <p className="text-xs text-green-700 dark:text-green-400">{text('An authenticated event for this business number was received.')}</p>}
    </section>
    {notice && <p role="status" className="text-xs text-gray-500">{notice}</p>}
    {(error || view?.error) && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error || view?.error}</p>}
    <MessageRuntimePanel channel="WhatsApp oficial" configured={!!configured && !!savedUrl && !dirty && !busy} desktop={desktop} useRuntime={useMetaRuntimeStore} parseChats={parseMetaChats}
      sourceHelp="Only new signed text messages for this business number and your allowed contacts are processed. Replies are limited to the 24-hour customer service window; templates, campaigns, groups and attachments are not supported in this first integration."
      inputHelp="Full individual numbers with country code"
      contactsHelp="Enter full individual phone numbers, including country code, without spaces. This official connector does not accept group IDs." />
  </ConnectorSection>
}
