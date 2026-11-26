import { create } from 'zustand'
import { useChatStore } from './chatStore'
import { useGenerationStore } from './generationStore'
import { useSettingsStore } from './settingsStore'
import { modelOutOfMode } from '../lib/modeGate'

export interface ComposerQueueTarget {
  conversationId: string
  model: string
}

interface QueuedMessage {
  id: number
  preview: string
  send: () => void | Promise<void>
  model: string
  failed?: boolean
}

interface ComposerQueue {
  messages: Record<string, QueuedMessage[]>
  sending: Record<string, true | number>
  enqueue: (target: ComposerQueueTarget, preview: string, send: QueuedMessage['send']) => void
  remove: (conversationId: string, id: number) => void
  retry: (conversationId: string, id: number) => void
  sendNext: (conversationId: string) => void
  track: (conversationId: string, result: void | Promise<void>, onError: (error: unknown) => void, queuedId?: number) => void
}

let nextId = 0

export const useComposerQueueStore = create<ComposerQueue>((set, get) => ({
  messages: {},
  sending: {},
  enqueue({ conversationId, model }, preview, send) {
    const message = { id: ++nextId, preview, send, model }
    set(state => ({ messages: {
      ...state.messages,
      [conversationId]: [...(state.messages[conversationId] ?? []), message],
    } }))
  },
  remove(conversationId, id) {
    set(state => ({ messages: {
      ...state.messages,
      [conversationId]: state.messages[conversationId]?.filter(message => message.id !== id) ?? [],
    } }))
  },
  retry(conversationId, id) {
    set(state => ({ messages: {
      ...state.messages,
      [conversationId]: state.messages[conversationId]?.map(message => message.id === id
        ? { ...message, failed: false }
        : message) ?? [],
    } }))
  },
  sendNext(conversationId) {
    const { messages, sending, remove, track } = get()
    const message = messages[conversationId]?.[0]
    if (!message || message.failed || sending[conversationId]) return
    const generation = useGenerationStore.getState()
    if (generation.runs[conversationId] || generation.generating[conversationId]
      || generation.aborters[conversationId]
      || modelOutOfMode(message.model, useSettingsStore.getState().settings.appMode)) return
    const fail = () => set(state => ({ messages: {
      ...state.messages,
      [conversationId]: state.messages[conversationId]?.map(item => item.id === message.id
        ? { ...item, failed: true }
        : item) ?? [],
    } }))
    if (!useChatStore.getState().conversations.some(conversation => conversation.id === conversationId)) return
    track(conversationId, Promise.resolve().then(async () => {
      if (get().messages[conversationId]?.[0]?.id !== message.id) return
      await message.send()
      remove(conversationId, message.id)
    }), fail, message.id)
  },
  track(conversationId, result, onError, queuedId) {
    set(state => ({ sending: { ...state.sending, [conversationId]: queuedId ?? true } }))
    void Promise.resolve(result).catch(onError).finally(() => set(state => {
      const sending = { ...state.sending }
      delete sending[conversationId]
      return { sending }
    }))
  },
}))

useChatStore.subscribe((state, previous) => {
  if (state.conversations.length >= previous.conversations.length) return
  const messages = useComposerQueueStore.getState().messages
  const retained = Object.entries(messages)
    .filter(([id]) => state.conversations.some(conversation => conversation.id === id))
  if (retained.length !== Object.keys(messages).length) {
    useComposerQueueStore.setState({ messages: Object.fromEntries(retained) })
  }
})

let drainScheduled = false
function scheduleDrain() {
  if (drainScheduled || !Object.values(useComposerQueueStore.getState().messages).some(queue => queue.length)) return
  drainScheduled = true
  queueMicrotask(() => {
    drainScheduled = false
    const { messages, sendNext } = useComposerQueueStore.getState()
    for (const conversationId of Object.keys(messages)) sendNext(conversationId)
  })
}

useComposerQueueStore.subscribe(scheduleDrain)
useGenerationStore.subscribe(scheduleDrain)
useSettingsStore.subscribe((state, previous) => {
  if (state.settings.appMode !== previous.settings.appMode) scheduleDrain()
})
