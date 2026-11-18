export interface AssistantIdentity {
  assistantName?: string
  assistantInstructions?: string
}

export function withAssistantIdentity(base: string, settings: AssistantIdentity = {}): string {
  const name = typeof settings.assistantName === 'string' ? settings.assistantName.trim().slice(0, 80) : ''
  const instructions = typeof settings.assistantInstructions === 'string' ? settings.assistantInstructions.trim().slice(0, 16_000) : ''
  const identity = [name ? `O nome escolhido pelo usuário para você é ${JSON.stringify(name)}.` : '', instructions].filter(Boolean).join('\n')
  return identity ? `${base}\n\n## Preferências gerais do usuário\n${identity}` : base
}
