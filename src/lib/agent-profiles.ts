export interface StudioAgentProfile {
  id: string
  name: string
  instructions: string
  /** Empty means the model selected by the user when opening a conversation. */
  model: string
}

export function agentProfileInput(name: string, instructions: string, model = ''): Omit<StudioAgentProfile, 'id'> {
  const title = name.trim(), body = instructions.trim(), selected = model.trim()
  if (!title || title.length > 80 || [...title].some(char => char.charCodeAt(0) < 32)) throw new Error('Informe um nome de até 80 caracteres para o agente.')
  if (!body || body.length > 16_000 || body.includes('\0')) throw new Error('As instruções do agente devem ter entre 1 e 16.000 caracteres.')
  if (selected.length > 500 || selected.startsWith('lu-cloud::')) throw new Error('Escolha um modelo local ou de um provedor configurado por você.')
  return { name: title, instructions: body, model: selected }
}

/** Agent instructions are separate from the optional role-playing persona. */
export function appendAgentInstructions(base: string, instructions?: string): string {
  if (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 16_000) return base
  return `${base}\n\n## Instruções do agente escolhido pelo usuário\n${instructions.trim()}`
}
