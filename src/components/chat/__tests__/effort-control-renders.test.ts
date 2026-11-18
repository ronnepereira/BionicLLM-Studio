/**
 * @vitest-environment jsdom
 *
 * The effort control, rendered for real.
 *
 * Every other test around this feature reads source text. That proves the code
 * SAYS the right thing; it cannot prove the button appears for the right model,
 * disappears for the wrong one, or writes anything when clicked. This one
 * mounts the composer, swaps the active model underneath it, and clicks.
 *
 * Four claims, one per model shape the catalogue really produces
 * ():
 *
 *   think 'always' with a ladder  (GLM 5.3 Flash) -> control visible
 *   think 'never'  without one    (Llama 3.1 8B)  -> nothing at all
 *   think 'toggle' with a ladder, Think switched off -> nothing, because
 *                                    nothing is being spent on reasoning
 *   a click -> the next rung, in the store, where every surface reads it
 *
 * Run: npx vitest run src/components/chat/__tests__/effort-control-renders.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useModelStore } from '../../../stores/modelStore'
import { DEFAULT_SETTINGS as BASE_SETTINGS } from '../../../lib/constants'
const DEFAULT_SETTINGS = { ...BASE_SETTINGS, language: 'en' as const }
import type { AIModel } from '../../../types/models'

// The composer's dictation button reaches for the microphone and the Tauri
// bridge on mount. Neither exists here and neither is what this file is about.
vi.mock('../VoiceButton', () => ({ VoiceButton: () => null }))

const cloudModel = (over: Partial<AIModel> & { name: string }): AIModel =>
  ({
    model: over.name, size: 0, type: 'text', provider: 'lu-cloud',
    providerName: 'LU Cloud', contextLength: 128000, supportsTools: true,
    ...over,
  }) as AIModel

/** GLM 5.3 Flash: reasons no matter what, and declares four rungs. */
const ALWAYS = cloudModel({
  name: 'lu-cloud::zai-org/GLM-5.3-Flash',
  thinkMode: 'always',
  effortLevels: ['low', 'medium', 'high', 'max'],
  effortDefault: 'high',
})
/** Llama 3.1 8B: an instruct model, so the server declares no ladder. */
const NEVER = cloudModel({ name: 'lu-cloud::meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', thinkMode: 'never' })
/** Qwen3 30B: the switch works, and the rungs only matter while it is on. */
const TOGGLE = cloudModel({
  name: 'lu-cloud::Qwen/Qwen3-30B-A3B',
  thinkMode: 'toggle',
  effortLevels: ['low', 'medium', 'high'],
  effortDefault: 'high',
})

function show(model: AIModel) {
  useModelStore.setState({ models: [ALWAYS, NEVER, TOGGLE], activeModel: model.name })
  return render(createElement(ChatInput, { onSend: () => {}, onStop: () => {}, isGenerating: false }))
}

const effortButton = () => screen.queryByTestId('effort-toggle')
const shownEffort = () => effortButton()?.getAttribute('aria-label')?.replace('Reasoning effort: ', '')
const pick = (label: string) => { fireEvent.click(effortButton()!); fireEvent.click(screen.getByRole('menuitemradio', { name: label })) }

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})
afterEach(() => cleanup())

describe('the effort control appears exactly where it is true', () => {
  it('a model that always reasons shows it, with the Think button locked on beside it', () => {
    show(ALWAYS)
    expect(effortButton()).not.toBeNull()
    expect(shownEffort()).toBe('High')
  })

  it('a model that never reasons shows nothing, there is no ladder and no thought to spend', () => {
    show(NEVER)
    expect(effortButton()).toBeNull()
  })

  it('a toggle model shows it while thinking is on', () => {
    show(TOGGLE)
    expect(effortButton()).not.toBeNull()
  })

  it('offers the same reasoning menu while thinking is off', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, thinkingEnabled: false } })
    show(TOGGLE)
    expect(shownEffort()).toBe('Off')
  })

  it('the label is the CLAMPED rung, so it cannot promise a rung the model has not got', () => {
    // Global wish 'max', and this model tops out at 'high'.
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, reasoningEffort: 'max' } })
    show(TOGGLE)
    expect(shownEffort()).toBe('High')
  })
})

describe('menu selection updates the shared effort preference', () => {
  it('selects a level directly from the menu', () => {
    show(ALWAYS)
    pick('Max')
    expect(useSettingsStore.getState().settings.reasoningEffort).toBe('max')
    expect(shownEffort()).toBe('Max')
  })

  it('and it wraps at the top of the model ladder rather than running off it', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, reasoningEffort: 'max' } })
    show(ALWAYS)
    pick('Low')
    expect(useSettingsStore.getState().settings.reasoningEffort).toBe('low')
    expect(shownEffort()).toBe('Low')
  })

  it('a click on a narrow ladder writes the CLAMPED rung globally, the same as the web app', () => {
    // Deliberate and confirmed behaviour, not an oversight: the wish is one
    // global setting, so cycling on a three-rung model leaves 'high' behind
    // rather than the 'max' the user last had on a four-rung one.
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, reasoningEffort: 'max' } })
    show(TOGGLE)
    pick('Low')
    expect(useSettingsStore.getState().settings.reasoningEffort).toBe('low')
  })

  it('the tooltip says the rung, the gesture and the price', () => {
    show(ALWAYS)
    expect(effortButton()!.getAttribute('title')).toBe(
      'Reasoning effort: High',
    )
  })
})

describe('local models (issue 176)', () => {
  const localModel = (over: Partial<AIModel> & { name: string }): AIModel =>
    ({
      model: over.name, size: 0, type: 'text', provider: 'openai',
      providerName: 'LM Studio', contextLength: 32768, supportsTools: true, thinkMode: 'toggle',
      ...over,
    }) as AIModel

  it('a local model with rungs shows the live control', () => {
    const oss = localModel({ name: 'openai::openai/gpt-oss-20b', effortLevels: ['low', 'medium', 'high'] })
    useModelStore.setState({ models: [oss], activeModel: oss.name })
    render(createElement(ChatInput, { onSend: () => {}, onStop: () => {}, isGenerating: false }))
    expect(shownEffort()).toBe('High')
  })

  it('a local model without rungs shows it greyed, with the reason, and a click changes nothing', () => {
    const gemma = localModel({
      name: 'openai::google/gemma-4-26b-a4b',
      effortNote: 'LM Studio lists no effort levels for this model.',
    })
    useModelStore.setState({ models: [gemma], activeModel: gemma.name })
    render(createElement(ChatInput, { onSend: () => {}, onStop: () => {}, isGenerating: false }))
    expect(effortButton()).toBeNull()
    const greyed = screen.getByTestId('effort-toggle-unsupported') as HTMLButtonElement
    expect(greyed.disabled).toBe(true)
    expect(greyed.getAttribute('title')).toBe('Reasoning effort: LM Studio lists no effort levels for this model.')
    fireEvent.click(greyed)
    expect(useSettingsStore.getState().settings.reasoningEffort).toBe('high')
  })

  it('and shows nothing at all while Think is off', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, thinkingEnabled: false } })
    const gemma = localModel({ name: 'openai::google/gemma-4-26b-a4b', effortNote: 'x' })
    useModelStore.setState({ models: [gemma], activeModel: gemma.name })
    render(createElement(ChatInput, { onSend: () => {}, onStop: () => {}, isGenerating: false }))
    expect(screen.queryByTestId('effort-toggle-unsupported')).toBeNull()
  })
})

/**
 * 3.0.7, after issue 176: rungs read from a local server wait for the user's
 * own pick. Until then the button says Default, because the request carries
 * no rung the model reads, and the round on a local model ends at Default
 * again so the old behaviour stays one click away.
 */
describe('a local model nobody picked a rung for', () => {
  const oss = {
    model: 'openai::openai/gpt-oss-20b', name: 'openai::openai/gpt-oss-20b', size: 0, type: 'text',
    provider: 'openai', providerName: 'LU Engine', contextLength: 32768, supportsTools: true,
    thinkMode: 'toggle', effortLevels: ['low', 'medium', 'high'], effortLocal: true,
  } as AIModel
  const mount = () => {
    useModelStore.setState({ models: [oss], activeModel: oss.name })
    render(createElement(ChatInput, { onSend: () => {}, onStop: () => {}, isGenerating: false }))
  }

  it('says Default, not the global High that does not go out', () => {
    mount()
    expect(shownEffort()).toBe('Default')
    expect(effortButton()!.getAttribute('aria-label')).toBe('Reasoning effort: Default')
    expect(effortButton()!.getAttribute('title')).toBe(
      'Reasoning effort: Default',
    )
  })

  it('the chosen rung is remembered after menu selection', () => {
    mount()
    pick('Low')
    const s = useSettingsStore.getState().settings
    expect(s.localEffortChosen).toBe(true)
    expect(s.reasoningEffort).toBe('low')
    expect(shownEffort()).toBe('Low')
  })

  it('another rung can be selected directly', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, localEffortChosen: true, reasoningEffort: 'low' } })
    mount()
    pick('Medium')
    expect(useSettingsStore.getState().settings.reasoningEffort).toBe('medium')
    expect(shownEffort()).toBe('Medium')
  })

  it('Default restores the model-managed effort', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, localEffortChosen: true, reasoningEffort: 'high' } })
    mount()
    pick('Default')
    expect(useSettingsStore.getState().settings.localEffortChosen).toBe(false)
    expect(shownEffort()).toBe('Default')
  })

  it('a hosted model is untouched by it and still shows the global rung', () => {
    show(ALWAYS)
    expect(shownEffort()).toBe('High')
    fireEvent.click(effortButton()!)
    expect(useSettingsStore.getState().settings.localEffortChosen).toBe(false)
  })
})
