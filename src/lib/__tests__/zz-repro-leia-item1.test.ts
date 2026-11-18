/**
 * REPRO (scratch, not committed): item 1 of leia.txt — "desativar o bu-server
 * quando um modelo na nuvem esta setado no chat; o modelo local nao esta sendo
 * descarregado da VRAM".
 *
 * Drives the REAL modelStore against the REAL generationStore, picks a cloud
 * model while a built-in GGUF is active, with NO local run booked, and records
 * every backendCall.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const backendCall = vi.fn(async (..._args: unknown[]) => ({}))
const unloadModel = vi.fn(async (..._args: unknown[]) => undefined)
const unloadLmStudioModel = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock('../../api/backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...a),
  isTauri: () => true,
}))
vi.mock('../../api/ollama', () => ({ unloadModel: (...a: unknown[]) => unloadModel(...a) }))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: (...a: unknown[]) => unloadLmStudioModel(...a) }))

import { useModelStore, __resetDeferredLocalUnloadsForTests } from '../../stores/modelStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { AIModel } from '../../types/models'

const builtin = (name: string): AIModel =>
  ({ name: `openai::${name}`, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'LU Engine' } as unknown as AIModel)
const cloud = (name: string): AIModel =>
  ({ name, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'OpenAI' } as unknown as AIModel)

beforeEach(() => {
  backendCall.mockClear()
  unloadModel.mockClear()
  unloadLmStudioModel.mockClear()
  __resetDeferredLocalUnloadsForTests()
  useGenerationStore.setState({ runs: {}, generating: {}, aborters: {} })
})

describe('picking a cloud model while the built-in engine holds a GGUF', () => {
  it('asks Rust to stop the bundled engine', () => {
    useModelStore.setState({ models: [builtin('qwenA'), cloud('gpt-x')], activeModel: 'openai::qwenA' })
    useModelStore.getState().setActiveModel('gpt-x')
    const stops = backendCall.mock.calls.filter((c) => c[0] === 'stop_bundled_engine')
    // Node/vitest timer: deferLocalUnload runs synchronously when the lane is free.
    expect(stops.length).toBe(1)
  })
})

describe('what appMode can even be in this fork', () => {
  it('updateSettings drops any attempt to switch to cloud', () => {
    useSettingsStore.getState().updateSettings({ appMode: 'cloud' })
    expect(useSettingsStore.getState().settings.appMode).toBe('local')
  })
})
