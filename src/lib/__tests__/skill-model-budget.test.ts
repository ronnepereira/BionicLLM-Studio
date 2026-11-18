import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ window: 1000000, local: false, model: '', settings: { contextDecay: true, smallModelMode: false, codexSendWindowTokens: 0 } }))
vi.mock('../context-compaction', () => ({ getChatWindowTokens: vi.fn(async (model: string) => { state.model = model; return state.window }) }))
vi.mock('../lan-openai-slot', () => ({ sendsToALanBackend: () => state.local }))
vi.mock('../model-send-window', () => ({ sendWindowFor: () => state.settings.codexSendWindowTokens }))
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: state.settings }) } }))
import { skillBudgetForModel } from '../skill-model-budget'
beforeEach(() => { state.window = 1000000; state.local = false; state.settings.codexSendWindowTokens = 0 })
it('uses the chosen cloud model window without a 10K or 32K ceiling', async () => {
  expect(await skillBudgetForModel('openai::cloud')).toEqual({ local: false, tokens: 400000 })
  expect(state.model).toBe('openai::cloud')
  state.window = 128000
  expect((await skillBudgetForModel('openai::other')).tokens).toBe(51200)
})
it('honors explicit send budgets and distinguishes LAN endpoints', async () => {
  state.settings.codexSendWindowTokens = 24000
  expect((await skillBudgetForModel('openai::cloud')).tokens).toBe(12000)
  state.local = true
  expect(await skillBudgetForModel('openai::local')).toEqual({ local: true, tokens: 400000 })
})
