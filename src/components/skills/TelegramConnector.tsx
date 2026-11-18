import { ConnectorSection } from './ConnectorSection'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, Loader2, RefreshCw, Send, Unplug } from 'lucide-react'
import { disconnectTelegram, telegramAvailable, telegramStatus, verifyTelegram, type TelegramBot } from '../../api/studio-telegram'
import { useUiText } from '../../lib/ui-text'
import { TelegramRuntimePanel } from './TelegramRuntimePanel'
import { useTelegramRuntimeStore } from '../../stores/telegramRuntimeStore'

export function TelegramConnector() {
  const text = useUiText()
  const desktop = telegramAvailable()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [bot, setBot] = useState<TelegramBot | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removed, setRemoved] = useState(false)
  const mounted = useRef(false)
  const operation = useRef(false)
  const receiverActive = useTelegramRuntimeStore(state => !!state.view?.active || !['idle', 'error'].includes(state.phase))
  useEffect(() => {
    mounted.current = true
    let disposed = false
    if (desktop) void telegramStatus().then(value => {
      if (!disposed) setConfigured(value)
    }).catch(() => { if (!disposed) setError(text('Could not read Telegram credential status.')) })
    return () => { disposed = true; mounted.current = false }
  }, [desktop, text])
  const act = async (action: 'save' | 'verify' | 'remove') => {
    if (operation.current || !desktop) return
    operation.current = true
    setBusy(true); setError(''); setRemoved(false)
    const candidate = token
    // Never persist tokens in a store, localStorage, logs or identity objects.
    setToken('')
    try {
      if (action === 'remove') {
        await disconnectTelegram()
        if (mounted.current) { setConfigured(false); setBot(null); setRemoved(true) }
      } else {
        const identity = await verifyTelegram(action === 'save' ? candidate : undefined)
        if (mounted.current) { setConfigured(true); setBot(identity) }
      }
    } catch (error) {
      if (mounted.current) { setBot(null); setError(error instanceof Error ? error.message : String(error)) }
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (token.trim()) void act('save') }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  return <ConnectorSection testId="telegram-connector" title={<><Send size={17} className="text-lu-accent" />Telegram · Bot API</>} status={!desktop ? text('Desktop app required') : configured === null ? error ? text('Credential status unavailable') : text('Checking credential…') : configured ? text('Credential saved') : text('Not configured')}>
    <p className="text-sm text-gray-500 dark:text-gray-400">{text('Connect a Telegram bot using a BotFather token. The credential is stored in the system vault, separately from Hermes and other apps.')}</p>
    {!desktop && <p className="text-xs text-gray-500">{text('The web preview shows the connector layout. Enter credentials only in the desktop app.')}</p>}
    <form onSubmit={submit} className="space-y-2" autoComplete="off">
      <label htmlFor="telegram-bot-token" className="flex items-center gap-2 text-sm"><KeyRound size={14} />{text('Bot token')}</label>
      <input id="telegram-bot-token" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} disabled={!desktop || busy || receiverActive} maxLength={150} placeholder={text('Paste the BotFather token')} className="w-full rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50" />
      <p className="text-xs text-gray-500">{text('Verify and save contacts Telegram over the internet. It does not send messages or change webhooks.')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button} disabled={!desktop || busy || receiverActive || !token.trim()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}{text('Verify and save')}</button>
        <button type="button" className={button} disabled={!desktop || busy || !configured} onClick={() => void act('verify')}><RefreshCw size={14} />{text('Verify saved credential')}</button>
        <button type="button" className={button} disabled={!desktop || busy || receiverActive || !configured} onClick={() => void act('remove')}><Unplug size={14} />{text('Remove local credential')}</button>
      </div>
    </form>
    {bot && <p role="status" className="text-sm text-green-700 dark:text-green-400">{text('Bot verified: {v0} (@{v1})', { v0: bot.first_name, v1: bot.username })}</p>}
    {removed && <p role="status" className="text-xs text-gray-500">{text('Local credential removed. The bot token remains valid in Telegram until revoked in BotFather.')}</p>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
    <TelegramRuntimePanel configured={!!configured && !busy} />
  </ConnectorSection>
}
