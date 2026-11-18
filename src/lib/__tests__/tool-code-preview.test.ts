import { describe, it, expect } from 'vitest'
import { toolCodePreview } from '../tool-code-preview'
import { codexConclusionMissing, codexStallVerdict } from '../../hooks/codex/stall-verdict'

describe('live code is passive, bounded and decoded', () => {
  it('shows partially received HTML with decoded line breaks and quotes', () => {
    const partial = JSON.stringify({ path: 'timer.html', content: '<button id="start">Iniciar</button>\n<script>start()</script>' }).slice(0, -2)
    expect(toolCodePreview('file_write', partial)).toBe('<button id="start">Iniciar</button>\n<script>start()</script>')
  })
  it('shows new edit text rather than the original file', () => {
    expect(toolCodePreview('file_edit', JSON.stringify({ old_string: 'old', new_string: 'new' }))).toBe('new')
  })
  it('does not expose unrelated tool arguments or arbitrary text', () => {
    expect(toolCodePreview('shell_execute', '{"content":"secret"}')).toBeUndefined()
    expect(toolCodePreview('file_read', '{"content":"original"}')).toBeUndefined()
    expect(toolCodePreview('file_write', '{"path":"a"')).toBeUndefined()
  })
  it('waits for incomplete Unicode and bounds the live window', () => {
    expect(toolCodePreview('file_write', '{"content":"' + String.raw`\u00`)).toBeUndefined()
    const text = Array.from({ length: 100 }, (_, i) => 'line' + i).join('\n')
    expect(toolCodePreview('file_write', JSON.stringify({ content: text }))?.split('\n')).toHaveLength(8)
    expect(toolCodePreview('file_write', JSON.stringify({ content: 'x'.repeat(5000) }))?.length).toBeLessThanOrEqual(1200)
  })
})

describe('a tool turn must get a model conclusion', () => {
  it('detects empty endings despite earlier tool narration', () => {
    expect(codexConclusionMissing(true, '')).toBe(true)
    expect(codexConclusionMissing(true, '   ')).toBe(true)
  })
  it.each(['Vou adicionar os ícones.', 'Agora vou aplicar as mudanças.', 'Primeiro, vou ler o arquivo.'])(
    'recognizes a Portuguese promise: %s', text => {
      expect(codexStallVerdict(text, text).nudgeWorthy).toBe(true)
      expect(codexConclusionMissing(true, text)).toBe(true)
    })
  it.each(['Adicionei os ícones e verifiquei o HTML.', 'Não consegui gravar: acesso negado.', 'As alterações estão preparadas, aguardando aprovação.'])(
    'accepts a substantive result or limitation: %s', text => expect(codexConclusionMissing(true, text)).toBe(false))
  it('does not require tool completion for a plain answer', () => {
    expect(codexConclusionMissing(false, '')).toBe(false)
    expect(codexConclusionMissing(false, 'A resposta é 4.')).toBe(false)
  })
})
