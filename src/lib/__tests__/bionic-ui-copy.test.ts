import { describe, expect, it } from 'vitest'
import { localizeUiText } from '../ui-copy'
import catalog from '../locales/pt-BR.json'
import { timeAgo } from '../time-ago'
import { formatDate } from '../formatters'

describe('Portuguese UI catalog', () => {
  it('keeps every interpolation parameter in the translated message', () => {
    for (const [source, translation] of Object.entries(catalog)) {
      expect(translation.match(/\{v\d+\}/g)?.sort() ?? [], source).toEqual(source.match(/\{v\d+\}/g)?.sort() ?? [])
    }
  })
  it('interpolates counts and preserves untrusted text as plain text', () => {
    expect(localizeUiText('pt-BR', 'Step {v0} of {v1} · {v2}', { v0: 2, v1: 4, v2: 'Imagem e vídeo' })).toBe('Etapa 2 de 4 · Imagem e vídeo')
    const path = 'C:\\Models\\Settings.gguf <script>alert(1)</script>'
    expect(localizeUiText('pt-BR', 'Failed to load {v0}', { v0: path })).toContain(path)
    expect(localizeUiText('en', 'Step {v0} of {v1}', { v0: 2, v1: 4 })).toBe('Step 2 of 4')
  })
  it('keeps technical names, missing values, and unknown diagnostics intact', () => {
    for (const name of ['BionicLLM Studio', 'Studio', 'GGUF', 'ComfyUI', 'LoRA', 'nvidia-smi', 'rocm-smi', 'md']) expect(localizeUiText('pt-BR', name)).toBe(name)
    expect(localizeUiText('pt-BR', 'LU Engine')).toBe('BU Engine')
    expect(localizeUiText('pt-BR', undefined)).toBe('')
    expect(localizeUiText('pt-BR', 'custom-engine::my-private-model')).toBe('custom-engine::my-private-model')
    expect(localizeUiText('en', 'Install a model')).toBe('Install a model')
    expect(localizeUiText('pt-BR', 'Install a model')).toBe('Instalar um modelo')
  })
  it('renders dates in Portuguese while keeping existing English callers compatible', () => {
    const now = Date.now()
    expect(timeAgo(now, now, 'pt-BR')).toBe('agora')
    expect(timeAgo(now - 14 * 86400000, now, 'pt-BR')).toBe('2 sem.')
    expect(timeAgo(now, now)).toBe('now')
    expect(formatDate(now - 5 * 60000, 'pt-BR')).toBe('há 5 min')
    expect(formatDate(now - 5 * 60000)).toBe('5m ago')
    expect(localizeUiText('en', '&middot;&middot;&middot;')).toBe('···')
  })
})
