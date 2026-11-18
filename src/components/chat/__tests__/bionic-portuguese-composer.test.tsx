/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from '../ChatInput'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'

beforeEach(() => {
  useSettingsStore.getState().updateSettings({ language: 'pt-BR' })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useModelStore.setState({ activeModel: 'ollama::qwen3:14b' })
})
afterEach(cleanup)

describe('localized composer', () => {
  it('switches labels without replacing the input, changing the draft, or translating the sent message', () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} onStop={() => {}} isGenerating={false} />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    const original = 'Settings --model C:\\Models\\my-model.gguf'
    fireEvent.change(input, { target: { value: original } })
    act(() => useSettingsStore.getState().updateSettings({ language: 'en' }))
    const englishInput = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(englishInput).toBe(input)
    expect(englishInput.value).toBe(original)
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith(original, undefined)
  })
})
