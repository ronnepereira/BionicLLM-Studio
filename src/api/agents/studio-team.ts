import type { ChatMessage } from '../providers/types'
import type { StudioAgentProfile } from '../../lib/agent-profiles'
import type { MCPToolDefinition, ToolArgs } from '../mcp/types'

export interface StudioAgentReport {
  status: 'completed' | 'changes_required' | 'blocked'
  summary: string
}
export interface StudioAgentSession {
  messages: ChatMessage[]
  report?: StudioAgentReport
  toolCalls: number
  stalled: number
  lastAction?: string
  lastBrief?: string
  instructions?: string
}
export const STUDIO_AGENT_REPORT: MCPToolDefinition = {
  name: 'studio_agent_report', source: 'builtin', category: 'workflow',
  description: 'Finish your current team stage with evidence, files changed and checks run. Call ALONE after your work. completed means your assigned stage is verified; a reviewer must inspect the actual result before approving. changes_required returns actionable findings to the author. blocked means progress requires user input; state the precise question or missing access. Never report completion for a plan or unfinished work.',
  inputSchema: { type: 'object', properties: {
    status: { type: 'string', enum: ['completed', 'changes_required', 'blocked'], description: 'Outcome of your assigned stage.' },
    summary: { type: 'string', description: 'Concrete results, paths, checks, actionable review findings, or the precise question for the user.' },
  }, required: ['status', 'summary'] },
}
export function parseStudioAgentReport(args: ToolArgs): StudioAgentReport {
  if (!['completed', 'changes_required', 'blocked'].includes(String(args.status)) || typeof args.summary !== 'string' || !args.summary.trim()) {
    throw new Error('Informe status completed, changes_required ou blocked e um summary com resultados concretos.')
  }
  return { status: args.status as StudioAgentReport['status'], summary: args.summary.trim() }
}
export type StudioTeamStage = (agent: StudioAgentProfile, goal: string, context: string, session: StudioAgentSession) => Promise<string>

/** Ordered handoffs: author -> reviewers -> author on findings. A stage keeps
 * its conversation across working slices, rather than restarting after five turns. */
export async function runStudioTeam(
  agents: StudioAgentProfile[], goal: string, stage: StudioTeamStage,
  options: { signal?: AbortSignal; progress?: (text: string) => void; report?: (agent: StudioAgentProfile, report: StudioAgentReport) => void; exists?: (id: string) => boolean } = {},
): Promise<{ status: 'completed' | 'blocked' | 'cancelled'; summary: string; reports: Array<StudioAgentReport & { agentId: string; name: string }> }> {
  if (!agents.length || agents.length > 8 || new Set(agents.map(a => a.id)).size !== agents.length || !goal.trim()) throw new Error('Informe de 1 a 8 agentes distintos e um objetivo concreto.')
  const reports: Array<StudioAgentReport & { agentId: string; name: string }> = []
  const sessions = new Map(agents.map(a => [a.id, { messages: [], toolCalls: 0, stalled: 0, instructions: a.instructions } as StudioAgentSession]))
  let previous = '', repeated = 0
  for (let round = 1; ; round++) {
    for (const agent of agents) {
      const session = sessions.get(agent.id)!
      session.report = undefined
      const context = `Your saved profile: ${agent.name}\n${agent.instructions}\n\nTeam order: ${agents.map(a => a.name).join(' -> ')}. Round ${round}. Shared goal: ${goal}\nUse the same workspace. Work on your assigned role, pass concrete evidence to the next agent. The last agent must verify the full deliverable. Continue until your stage is done or genuinely blocked. End with studio_agent_report.\n\nLatest team handoffs:\n${reports.slice(-agents.length).map(r => `${r.name} (${r.status}): ${r.summary}`).join('\n\n').slice(-24000)}`
      for (;;) {
        if (options.signal?.aborted) return { status: 'cancelled', summary: 'Execução interrompida pelo usuário.', reports }
        if (options.exists && !agents.every(a => options.exists!(a.id))) return { status: 'blocked', summary: 'Um agente da equipe foi removido. Selecione novamente os participantes.', reports }
        options.progress?.(`${agent.name}: trabalhando (rodada ${round})`)
        const before = session.toolCalls
        const output = await stage(agent, goal, context, session)
        if (options.signal?.aborted) return { status: 'cancelled', summary: 'Execução interrompida pelo usuário.', reports }
        if (session.report) break
        if (/^\s*(Error:|Refused:)/i.test(output) || session.stalled >= 6 || session.toolCalls === before) {
          return { status: 'blocked', summary: `${agent.name}: ${output || 'Sem progresso verificável; é necessário revisar as instruções ou o acesso às ferramentas.'}`, reports }
        }
        options.progress?.(`${agent.name}: continuando com o contexto preservado`)
      }
      // The stage mutates this field asynchronously; TS otherwise retains
      // the undefined narrowing from the beginning of this stage.
      const report = (session as StudioAgentSession).report!
      reports.push({ agentId: agent.id, name: agent.name, ...report })
      options.report?.(agent, report)
      if (report.status === 'blocked') return { status: 'blocked', summary: `${agent.name}: ${report.summary}`, reports }
      if (report.status === 'changes_required') break
      if (agent === agents[agents.length - 1]) return { status: 'completed', summary: report.summary, reports }
    }
    const feedback = reports.slice(-agents.length).map(r => `${r.agentId}:${r.status}:${r.summary}`).join('\n')
    repeated = feedback === previous ? repeated + 1 : 0
    previous = feedback
    if (repeated >= 2) return { status: 'blocked', summary: 'A equipe repetiu as mesmas conclusões sem avançar. Revise os apontamentos ou forneça a informação solicitada.', reports }
  }
}
