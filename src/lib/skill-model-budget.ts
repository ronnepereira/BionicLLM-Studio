import { getChatWindowTokens } from './context-compaction'
import { getProviderIdFromModel } from '../api/providers/model-name'
import { sendsToALanBackend } from './lan-openai-slot'
import { effectiveSendWindow, isPaidProvider } from './send-window'
import { sendWindowFor } from './model-send-window'
import { useSettingsStore } from '../stores/settingsStore'
import type { SkillPromptBudget } from './skills'

/** Resolve independently for each request/model, including groups and delegates. */
export async function skillBudgetForModel(model: string): Promise<SkillPromptBudget> {
  const settings = useSettingsStore.getState().settings
  const providerId = getProviderIdFromModel(model)
  const localBackend = sendsToALanBackend(providerId, model)
  const local = !isPaidProvider(providerId, localBackend)
  const window = await getChatWindowTokens(model)
  const input = effectiveSendWindow({ providerId, modelWindow: window,
    sendWindowTokens: sendWindowFor(settings, model), localBackend,
    capEnabled: settings.contextDecay, smallModelMode: settings.smallModelMode })
  // Half the input remains for conversation, RAG, tools and other system sections.
  // The send-window resolver already reserves output/protocol capacity.
  return { local, tokens: Math.floor(input * .5) }
}
