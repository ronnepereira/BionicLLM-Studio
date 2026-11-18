import { useState } from 'react'
import { Bot, Play, Square, Send, Trash2, MessageSquare } from 'lucide-react'
import type { UseBoundStore, StoreApi } from 'zustand'
import type { MessageRuntimeState } from '../../stores/createMessageRuntime'
import type { MessageChannel } from '../../lib/messaging'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { useUiText } from '../../lib/ui-text'

interface Props<Id extends string | number> {
  configured: boolean
  channel: MessageChannel
  desktop: boolean
  useRuntime: UseBoundStore<StoreApi<MessageRuntimeState<Id>>>
  parseChats: (value: string) => Id[]
  sourceHelp: string
  inputHelp: string
  contactsHelp?: string
}
export function MessageRuntimePanel<Id extends string | number>({ configured, channel, desktop, useRuntime, parseChats, sourceHelp, inputHelp, contactsHelp }: Props<Id>) {
  const text = useUiText()
  const runtime = useRuntime()
  const profiles = useAgentProfileStore(state => state.profiles)
  const [chats, setChats] = useState<string | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [autoReply, setAutoReply] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState('')
  const selected = agentId ?? runtime.view?.saved.config.agent_id ?? ''
  const allowed = chats ?? runtime.view?.saved.config.chats.join('\n') ?? ''
  const automatic = autoReply ?? runtime.view?.saved.config.auto_reply ?? false
  const profile = profiles.find(profile => profile.id === selected)
  const running = !['idle', 'error'].includes(runtime.phase) || !!runtime.view?.active
  const button = 'lu-control lu-control--outline inline-flex items-center gap-2 disabled:opacity-50'
  const field = 'w-full rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm disabled:opacity-50'
  const start = async () => {
    setError('')
    try {
      if (!profile) throw new Error(text('Choose an agent with a specific text model.'))
      await runtime.start({ chats: parseChats(allowed), agent_id: profile.id, auto_reply: automatic }, profile)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  const action = async (id: string, send: boolean) => {
    if (pending) return
    setPending(id)
    try { await (send ? runtime.send(id) : runtime.discard(id)) }
    finally { setPending('') }
  }
  const openConversation = (id: string) => {
    if (!useChatStore.getState().conversations.some(conversation => conversation.id === id)) {
      setError(text('This conversation is no longer available.')); return
    }
    useChatStore.getState().setActiveConversation(id)
    useUIStore.getState().setView('chat')
  }
  return <section aria-label={text('Receiver for {v0}', { v0: channel })} className="border-t border-gray-200 dark:border-white/10 pt-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-medium"><Bot size={16} />{text('Messages and agent')}</h4><span role="status" className="text-xs text-gray-500">{text(({ idle: 'Receiver stopped', loading: 'Loading receiver…', starting: 'Starting receiver…', listening: 'Waiting for messages', generating: 'Preparing a reply', stopping: 'Stopping receiver…', error: 'Receiver needs attention' } as const)[runtime.phase])}</span></div>
    <p className="text-xs text-gray-500">{text(sourceHelp)}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">{text('Assigned agent')}<select aria-label={text('Assigned agent')} className={`${field} mt-1`} value={selected} disabled={!desktop || running} onChange={event => setAgentId(event.target.value)}><option value="">{text('Choose an agent')}</option>{selected && !profile && <option value={selected}>{text('Agent unavailable')}</option>}{profiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.model}>{profile.name}{!profile.model ? ` · ${text('Select a model first')}` : ''}</option>)}</select></label>
      <label className="block text-sm">{text('Allowed chat IDs')}<textarea aria-label={text('Allowed chat IDs')} className={`${field} mt-1 min-h-20`} value={allowed} disabled={!desktop || running} maxLength={900} placeholder={text(inputHelp)} onChange={event => setChats(event.target.value)} /></label>
    </div>
    <p className="text-xs text-gray-500">{text(contactsHelp ?? 'For groups, this authorizes messages from every member of the listed group. Find the chat ID with a bot or tool you trust. This app does not discover contacts or read other accounts.')}</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-blue-500" checked={automatic} disabled={!desktop || running} onChange={event => setAutoReply(event.target.checked)} /><span>{text('Send agent replies automatically to allowed chats')}</span></label>
    <p className="text-xs text-gray-500">{automatic ? text('Automatic sending is selected. Activating the receiver authorizes replies in these chats without asking for each message.') : text('Review mode: the agent prepares drafts. Nothing is sent until you click Send reply.')}</p>
    <p className="text-xs text-gray-500">{text('Messages go to the model configured in the selected agent, including an external provider if selected. Active skills apply to each reply. Each message has its own conversation; computer tools are unavailable.')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!desktop || !configured || running || !profile?.model || !allowed.trim()} onClick={() => void start()}><Play size={14} />{text('Activate receiver')}</button>
      <button type="button" className={button} disabled={!desktop || !running} onClick={() => void runtime.stop()}><Square size={14} />{text('Stop receiver')}</button>
      <button type="button" className={button} onClick={() => useUIStore.getState().setView('agents')}>{text('Manage agents')}</button>
    </div>
    <p className="text-xs text-gray-500">{text('Stop cancels pending work. A reply already accepted by {v0} cannot be recalled. The receiver stays off after restarting the app; interrupted messages are not replayed.', { v0: channel })}</p>
    {(error || runtime.error) && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error || runtime.error}</p>}
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{text('Recent messages and drafts')}</h4>
      <p className="text-xs text-gray-500">{text('Up to 20 entries are kept locally. Pending drafts and unconfirmed sends are preserved until you review or discard them.')}</p>
      {!runtime.view?.saved.history.length && <p className="text-sm text-gray-500">{text('No messages received through {v0} yet.', { v0: channel })}</p>}
      {runtime.view?.saved.history.slice().reverse().map(row => <article key={row.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500"><span className="break-all">{text('Chat')} · {row.chat_id}</span><span>{text(({ received: 'Waiting for agent', processing: 'Preparing a reply', draft: 'Draft awaiting review', sent: 'Sent', failed: 'Generation failed', interrupted: 'Interrupted', skipped: 'Discarded', uncertain: 'Send not confirmed — check {v0}' } as const)[row.status], { v0: channel })}</span></div>
        <p className="text-sm whitespace-pre-wrap break-words line-clamp-4">{row.text}</p>
        {row.reply && <details className="text-sm"><summary className="cursor-pointer text-lu-accent">{text('Agent reply')}</summary><p className="mt-2 whitespace-pre-wrap break-words">{row.reply}</p></details>}
        {row.status === 'uncertain' && <p className="text-xs text-amber-600 dark:text-amber-400">{text('Delivery may have occurred. Check the chat before taking any action. Automatic retry is disabled.')}</p>}
        <div className="flex flex-wrap gap-2">
          {row.status === 'draft' && <button className={button} type="button" disabled={!desktop || !runtime.view?.active || !!pending} onClick={() => void action(row.id, true)}><Send size={13} />{text('Send reply')}</button>}
          {['draft', 'uncertain'].includes(row.status) && <button className={button} type="button" disabled={!desktop || !!pending} onClick={() => void action(row.id, false)}><Trash2 size={13} />{text('Discard reply')}</button>}
          {row.conversation_id && <button className={button} type="button" onClick={() => openConversation(row.conversation_id!)}><MessageSquare size={13} />{text('Open conversation')}</button>}
        </div>
      </article>)}
    </div>
  </section>
}
