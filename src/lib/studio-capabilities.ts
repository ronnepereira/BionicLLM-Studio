export const STUDIO_TOOL_NAMES = ['studio_capabilities', 'studio_agents_list', 'studio_agent_create', 'studio_schedule_create'] as const
export const STUDIO_APP_CONTEXT = `BionicLLM Studio has native Agents (saved agent profiles), Schedules, RAG documents, chat, Code, browser tools, settings, plugins and image/voice features. For an agent or timer inside this app, use studio_capabilities, studio_agents_list, studio_agent_create and studio_schedule_create when offered. A PowerShell/Python script is not a substitute for creating an agent or schedule in the app. Do not claim creation until the tool succeeds and returns its saved ID. Scheduling uses the app's Agenda and runs while the application is running, including the system tray; a fully exited app cannot run timers. List existing agents/schedules before creating them. To correct an existing schedule, pass its scheduleId; do not create a second timer. For intervals use relative startInMinutes (0 for now) instead of guessing an absolute date. Ask for missing task/timing details; do not invent them. Feature availability depends on configured models, providers, plugins and permissions. Only perform actions through tools actually offered on this turn.`
export function withStudioCapabilities(base: string): string {
  return base.includes(STUDIO_APP_CONTEXT) ? base : `${base}\n\n${STUDIO_APP_CONTEXT}`
}
export function asksForStudioManagement(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(crie|criar|escreva|write|create|generate)\s+(um\s+|a\s+)?(script|arquivo|file|classe|class)\b/.test(t)) return false
  return /\bstudio_(capabilities|agents_list|agent_create|schedule_create)\b/.test(t)
    || /\b(crie|criar|cria|create|configure|configurar|cadastrar|cadastre|salve|save|quero|preciso|monte|make|adicione|adicionar|listar|liste|list|mostrar|mostre|quais|meus)\b[\s\S]{0,120}\b(agentes?|agents?|agendamentos?|schedules?|lembretes?)\b/.test(t)
    || /\b(agende|agendar|schedule|lembre-me|me lembre)\b/.test(t)
    || /\b(o que|quais|what)\b[\s\S]{0,80}\b(app|aplicativo|bionicllm)\b[\s\S]{0,40}\b(faz|oferece|pode|can|features|recursos)\b/.test(t)
}
