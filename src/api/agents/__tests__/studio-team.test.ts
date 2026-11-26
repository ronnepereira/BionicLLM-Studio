import { expect, it, vi } from 'vitest'
import { parseStudioAgentReport, runStudioTeam, type StudioTeamStage } from '../studio-team'

const agents = [
  { id: 'author', name: 'Autor', instructions: 'Escreva e teste o código.', model: 'model-a' },
  { id: 'reviewer', name: 'Revisor', instructions: 'Inspecione os arquivos e execute os testes.', model: 'model-b' },
]
it('hands review findings back to the author with the same sessions, then verifies again', async () => {
  const calls: string[] = [], sessions = new Map(), contexts: string[] = []
  const stage: StudioTeamStage = async (agent, _goal, context, session) => {
    calls.push(agent.id); contexts.push(context)
    if (sessions.has(agent.id)) expect(session).toBe(sessions.get(agent.id))
    sessions.set(agent.id, session)
    session.report = agent.id === 'reviewer' && calls.length === 2
      ? { status: 'changes_required', summary: 'Corrigir validação em app.ts:12.' }
      : { status: 'completed', summary: calls.length === 4 ? 'Validado: arquivos revisados e testes passaram.' : 'Código gravado e testado.' }
    return session.report.summary
  }
  const report = vi.fn()
  const result = await runStudioTeam(agents, 'Criar app.ts com validação e testes', stage, { report })
  expect(calls).toEqual(['author', 'reviewer', 'author', 'reviewer'])
  expect(contexts[2]).toContain('Corrigir validação em app.ts:12.')
  expect(result.status).toBe('completed'); expect(report).toHaveBeenCalledTimes(4)
})
it('continues across more than five working slices while preserving the stage context', async () => {
  let slices = 0
  const result = await runStudioTeam(agents.slice(0, 1), 'Implementar', async (_agent, _goal, _context, session) => {
    session.toolCalls++; slices++
    if (slices === 7) session.report = { status: 'completed', summary: 'Entregue e testado' }
    return 'Trabalho parcial'
  })
  expect(slices).toBe(7); expect(result.status).toBe('completed')
})
it('returns a real blocker and its question without starting the next agent', async () => {
  const stage = vi.fn<StudioTeamStage>(async (_a, _g, _c, session) => {
    session.report = { status: 'blocked', summary: 'Qual pasta contém o projeto?' }
    return session.report.summary
  })
  expect(await runStudioTeam(agents, 'Corrigir o projeto', stage)).toMatchObject({ status: 'blocked', summary: 'Autor: Qual pasta contém o projeto?' })
  expect(stage).toHaveBeenCalledOnce()
})
it('honors Stop between slices', async () => {
  const controller = new AbortController()
  const stage = vi.fn<StudioTeamStage>(async (_a, _g, _c, session) => { session.toolCalls++; controller.abort(); return '' })
  expect((await runStudioTeam(agents, 'Trabalhar', stage, { signal: controller.signal })).status).toBe('cancelled')
  expect(stage).toHaveBeenCalledOnce()
})
it('does not mark an error or an unverified prose answer as completed', async () => {
  expect((await runStudioTeam(agents, 'Trabalhar', async () => 'Vou começar.')).status).toBe('blocked')
  expect((await runStudioTeam(agents, 'Trabalhar', async () => 'Error: sem acesso')).status).toBe('blocked')
})
it('stops a review cycle that repeats the same conclusions without progress', async () => {
  let calls = 0
  const result = await runStudioTeam(agents, 'Trabalhar', async (agent, _g, _c, session) => {
    calls++; session.report = { status: agent.id === 'author' ? 'completed' : 'changes_required', summary: 'O mesmo apontamento.' }
    return session.report.summary
  })
  expect(result.status).toBe('blocked'); expect(calls).toBeLessThan(12)
})
it('stops when a participant is deleted and validates IDs before inference', async () => {
  const stage = vi.fn()
  expect((await runStudioTeam(agents, 'Trabalhar', stage, { exists: () => false })).status).toBe('blocked')
  expect(stage).not.toHaveBeenCalled()
  await expect(runStudioTeam([agents[0], agents[0]], 'Trabalhar', stage)).rejects.toThrow('distintos')
  await expect(runStudioTeam([], 'Trabalhar', stage)).rejects.toThrow('agentes')
})
it('requires a structured outcome and concrete summary', () => {
  expect(() => parseStudioAgentReport({ status: 'done', summary: 'ok' })).toThrow()
  expect(() => parseStudioAgentReport({ status: 'completed', summary: ' ' })).toThrow()
})
