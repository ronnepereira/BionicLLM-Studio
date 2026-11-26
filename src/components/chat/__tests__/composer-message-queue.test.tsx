// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from '../ChatInput'
import { useChatStore } from '../../../stores/chatStore'
import { useComposerQueueStore } from '../../../stores/composerQueueStore'
import { useGenerationStore } from '../../../stores/generationStore'
import { useModelStore } from '../../../stores/modelStore'

const model = 'ollama:queue-model'

afterEach(() => {
  cleanup()
  useComposerQueueStore.setState({ messages: {}, sending: {} })
  useGenerationStore.setState({ generating: {}, runs: {}, aborters: {} })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useModelStore.setState({ activeModel: null })
})

describe('desktop composer queue', () => {
  it('queues via Enter and button, allows removal, and sends in order to the original chat', async () => {
    const chat = useChatStore.getState().createConversation(model, '')
    useModelStore.setState({ activeModel: model })
    useGenerationStore.getState().setGenerating(chat, true)
    let finishFirst: () => void = () => {}
    const onSend = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve }))
    render(<ChatInput onSend={onSend} onStop={vi.fn()} isGenerating enableMessageQueue />)
    const field = screen.getByRole('textbox')
    const write = (value: string) => fireEvent.change(field, { target: { value } })
    const enter = () => fireEvent.keyDown(field, { key: 'Enter' })

    write('first follow-up')
    enter()
    write('remove this')
    fireEvent.click(screen.getByRole('button', { name: 'Colocar mensagem na fila' }))
    write('second follow-up')
    enter()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover mensagem da fila' })[1])
    expect(screen.queryByText('remove this')).toBeNull()
    expect(screen.getByRole('button', { name: 'Parar geração' })).toBeTruthy()
    expect(onSend).not.toHaveBeenCalled()

    act(() => {
      useChatStore.getState().createConversation('ollama:other-model', '')
      useModelStore.setState({ activeModel: 'ollama:other-model' })
      useGenerationStore.getState().setGenerating(chat, false)
    })
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend).toHaveBeenNthCalledWith(1, 'first follow-up', undefined, undefined, undefined, { conversationId: chat, model })
    await act(async () => finishFirst())
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend).toHaveBeenNthCalledWith(2, 'second follow-up', undefined, undefined, undefined, { conversationId: chat, model })
  })

  it('keeps a failed send in the queue and resumes only after an explicit retry', async () => {
    const chat = useChatStore.getState().createConversation(model, '')
    const send = vi.fn().mockRejectedValueOnce(new Error('fixture'))
    const next = vi.fn()
    const queue = useComposerQueueStore.getState()
    queue.enqueue({ conversationId: chat, model }, 'first', send)
    queue.enqueue({ conversationId: chat, model }, 'next', next)
    await waitFor(() => expect(useComposerQueueStore.getState().messages[chat]?.[0].failed).toBe(true))
    expect(send).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
    queue.retry(chat, useComposerQueueStore.getState().messages[chat][0].id)
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1))
  })
})
