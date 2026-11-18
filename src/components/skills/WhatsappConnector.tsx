import { ConnectorSection } from './ConnectorSection'
import { useEffect, useState } from 'react'
import { Download, RefreshCw, QrCode, Unplug, MessageCircle } from 'lucide-react'
import { whatsappAvailable, whatsappComponent, whatsappRuntime, installWhatsapp, connectWhatsapp, disconnectWhatsapp, forgetWhatsapp, type WhatsAppComponent, type WhatsAppView } from '../../api/studio-whatsapp'
import { useWhatsappRuntimeStore } from '../../stores/whatsappRuntimeStore'
import { parseWhatsappChats } from '../../lib/whatsapp'
import { useUiText } from '../../lib/ui-text'
import { MessageRuntimePanel } from './MessageRuntimePanel'

export function WhatsappConnector() {
  const text = useUiText()
  const desktop = whatsappAvailable()
  const [component, setComponent] = useState<WhatsAppComponent | null>(null)
  const [view, setView] = useState<WhatsAppView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  useEffect(() => {
    if (!desktop) return
    let disposed = false, checking = false
    void whatsappComponent().then(value => { if (!disposed) setComponent(value) }).catch(() => { if (!disposed) setError(text('Could not check the WhatsApp component.')) })
    const refresh = async () => {
      if (checking) return
      checking = true
      try { const value = await whatsappRuntime(); if (!disposed) setView(value) }
      catch { if (!disposed) setError(text('Could not read the WhatsApp connection status.')) }
      finally { checking = false }
    }
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 1500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [desktop, text])
  const act = async (action: 'check' | 'install' | 'connect' | 'disconnect' | 'forget') => {
    if (busy || !desktop) return
    setBusy(true); setError('')
    try {
      if (action === 'check') setComponent(await whatsappComponent())
      if (action === 'install') setComponent(await installWhatsapp())
      if (action === 'connect') setView(await connectWhatsapp())
      if (action === 'disconnect' || action === 'forget') {
        await useWhatsappRuntimeStore.getState().stop()
        await disconnectWhatsapp()
        if (action === 'forget') { await forgetWhatsapp(); setConfirmRemoval(false) }
      }
      setView(await whatsappRuntime())
      await useWhatsappRuntimeStore.getState().refresh()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const phase = view?.phase ?? 'disconnected'
  const connected = phase === 'connected'
  const connecting = ['connecting', 'qr'].includes(phase)
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  return <ConnectorSection testId="whatsapp-connector" title={<><MessageCircle size={17} className="text-lu-accent" />WhatsApp · QR Code · {text('Unofficial')}</>} status={!desktop ? text('Desktop app required') : text(({ disconnected: 'Disconnected', connecting: 'Connecting…', qr: 'Scan the QR code', connected: 'Connected', 'logged-out': 'Pairing expired', error: 'Connection needs attention' } as const)[phase])}>
    <p className="text-sm text-gray-500 dark:text-gray-400">{text('Pair your WhatsApp using Baileys, the method used by Hermes for QR connections. This is separate from the official Meta Business API.')}</p>
    <p className="text-xs text-gray-500">{text('Your BionicLLM session is encrypted with a key kept in the system vault. Sessions from Hermes and other apps are not reused.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('This web preview shows the controls. Installation, QR pairing and messages work in the desktop app.')}</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!desktop || busy} onClick={() => void act('check')}><RefreshCw size={13} />{text('Check component')}</button>
      {!component?.ready && <button className={button} disabled={!desktop || busy || connected || connecting} onClick={() => void act('install')}><Download size={13} />{busy ? text('Please wait…') : text('Install WhatsApp component')}</button>}
      <button className={button} disabled={!desktop || busy || !component?.ready || connected || connecting} onClick={() => void act('connect')}><QrCode size={13} />{text('Connect or generate QR code')}</button>
      <button className={button} disabled={!desktop || busy || (!connected && !connecting)} onClick={() => void act('disconnect')}><Unplug size={13} />{text('Disconnect')}</button>
    </div>
    {desktop && component && !component.node && <p className="text-xs text-gray-500">{text('Install Node.js 22 or newer with npm before installing this component.')}</p>}
    {component?.ready && <p className="text-xs text-gray-500">Baileys {component.version} · {text('Component installed')}</p>}
    {phase === 'logged-out' && <p className="text-xs text-gray-500">{text('This device was unlinked. Remove the local session and generate a new QR code to pair again.')}</p>}
    {view?.qr && phase === 'qr' && <div className="flex flex-col items-center gap-3 rounded-lg border border-gray-200 dark:border-white/10 p-4"><img src={`data:image/png;base64,${view.qr}`} width={260} height={260} className="h-auto max-w-full bg-white p-2 rounded" alt={text('WhatsApp pairing QR code')} /><p className="text-sm text-gray-500 text-center">{text('On your phone, open WhatsApp → Linked devices → Link a device, then scan this code. The code refreshes automatically.')}</p></div>}
    {(error || view?.error) && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error || view?.error}</p>}
    <div className="space-y-2">
      <button className={button} disabled={!desktop || busy || connected || connecting} onClick={() => confirmRemoval ? void act('forget') : setConfirmRemoval(true)}>{confirmRemoval ? text('Confirm local session removal') : text('Remove local session')}</button>
      {confirmRemoval && <><button className={`${button} ml-2`} onClick={() => setConfirmRemoval(false)}>{text('Cancel')}</button><p className="text-xs text-gray-500">{text('This removes the encrypted session on this computer. To revoke the linked device on WhatsApp, remove BionicLLM from Linked devices on your phone.')}</p></>}
    </div>
    <MessageRuntimePanel channel="WhatsApp" configured={connected && !busy} desktop={desktop} useRuntime={useWhatsappRuntimeStore} parseChats={parseWhatsappChats}
      sourceHelp="Only new text messages from the allowed WhatsApp chats are processed while the receiver is active. Your own messages, status updates, history sync, edits and attachments are ignored. Pairing alone does not activate replies."
      inputHelp="Full numbers with country code, or group IDs ending in @g.us" />
  </ConnectorSection>
}
