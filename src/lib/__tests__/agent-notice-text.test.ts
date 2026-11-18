import { describe, expect, it } from 'vitest'
import { localizeAgentNotice } from '../agent-notice-text'

it('translates file application notices and preserves merge warnings', () => {
  expect(localizeAgentNotice('Applied staged change: C:/projeto/a.html', 'pt-BR')).toBe('Alteração aplicada: C:/projeto/a.html')
  expect(localizeAgentNotice('Applied staged change: C:/projeto/a.html (merged with 2 changes made on disk since it was staged, so this file is not byte for byte the diff you approved)', 'pt-BR')).toContain('conteúdo final difere')
})

describe('app-authored agent notices', () => {
  it('translates stored summaries without altering their counts', () => {
    const source = 'Summarised 10 earlier step messages of this run to stay inside the context window, about 130 tokens less in every following step. The run goes on from the summary; every result is still here in the chat.'
    expect(localizeAgentNotice(source, 'pt-BR')).toContain('10 mensagens')
    expect(localizeAgentNotice(source, 'pt-BR')).toContain('130 tokens')
    expect(localizeAgentNotice(source, 'en')).toBe(source)
  })
  it('translates interruption notices and appended status while preserving model prose', () => {
    const reason = 'same tool sequence repeated 3× in a row'
    expect(localizeAgentNotice(`⛔ Loop guard halted the run: ${reason}.`, 'pt-BR')).toContain('3 vezes seguidas')
    const source = `Minha resposta.\n\n_(halted: ${reason}. The model is looping. Try a stronger model for multi-step tasks, or rephrase the instruction.)_`
    const result = localizeAgentNotice(source, 'pt-BR')
    expect(result).toContain('Minha resposta.\n\n_(Execução interrompida.')
    expect(result).not.toContain('The model is looping')
    expect(localizeAgentNotice('Summarised is an English word.', 'pt-BR')).toBe('Summarised is an English word.')
  })
})
