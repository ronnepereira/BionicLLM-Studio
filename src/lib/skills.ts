import { estimateTokens } from './token-estimate'
import type { SkillCategory } from './skill-categories'
// Storage guard, independent of any model context window.
export const SKILL_TEXT_LIMIT = 4_000_000
export const SKILL_FILE_LIMIT = 16_000_000
export const ACTIVE_SKILL_TEXT_LIMIT = 32_000
export interface SkillPromptBudget { tokens: number; local: boolean }

export interface StudioSkill {
  id: string
  name: string
  instructions: string
  enabled: boolean
  category?: SkillCategory
  templateId?: string
  sourcePath?: string
  description?: string
}

export const SKILL_TEMPLATES = [
  {
    id: 'code-review', name: 'Code review',
    description: 'Review code for concrete bugs, regressions and missing checks.',
    instructions: 'Ao revisar código, priorize falhas demonstráveis, regressões e riscos de perda de dados. Explique o impacto e a condição que provoca cada problema. Cite arquivos e trechos quando disponíveis. Só afirme que executou testes se realmente os executou. Preserve o escopo solicitado pelo usuário e respeite as permissões das ferramentas.',
  },
  {
    id: 'research', name: 'Source-based research',
    description: 'Organize research, cite sources and distinguish facts from uncertainty.',
    instructions: 'Em tarefas de pesquisa, identifique o que precisa ser respondido, consulte fontes disponíveis e cite as fontes efetivamente consultadas. Distinga fatos, inferências e pontos não confirmados. Não invente links, resultados de busca ou acesso a fontes. Se não houver busca disponível, informe essa limitação. Respeite as permissões das ferramentas.',
  },
  {
    id: 'writing', name: 'Clear writing',
    description: 'Write and revise concise texts in Brazilian Portuguese.',
    instructions: 'Ao escrever ou revisar textos, use português do Brasil claro, com frases diretas e palavras concretas, salvo quando o usuário pedir outro idioma. Preserve o sentido e os fatos fornecidos. Evite repetições, exageros e afirmações sem fundamento. Adapte o tom ao público e entregue o texto solicitado.',
  },
] as const

export function skillInput(name: string, instructions: string): Pick<StudioSkill, 'name' | 'instructions'> {
  const title = name.trim()
  const body = instructions.trim()
  if (!title || title.length > 80 || [...title].some(char => char.charCodeAt(0) < 32)) throw new Error('Informe um nome de até 80 caracteres.')
  if (!body || body.length > SKILL_TEXT_LIMIT || body.includes('\0')) throw new Error('As instruções devem ter entre 1 e 4.000.000 caracteres.')
  return { name: title, instructions: body }
}

export function previewSkillMarkdown(markdown: string, filename: string): Pick<StudioSkill, 'name' | 'instructions'> {
  if (markdown.length > SKILL_FILE_LIMIT) throw new Error('A prévia aceita arquivos de até 16 MB.')
  let body = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  let name = ''
  // SKILL.md front matter is data. Never evaluate YAML, code or commands.
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(body)
  if (front) {
    name = /^name:\s*(.+)$/m.exec(front[1])?.[1]?.replace(/^["']|["']$/g, '').trim() ?? ''
    body = body.slice(front[0].length).trim()
  }
  name ||= /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? filename.replace(/\.md$/i, '')
  return { name, instructions: body }
}

export function parseSkillMarkdown(markdown: string, filename: string): Pick<StudioSkill, 'name' | 'instructions'> {
  const preview = previewSkillMarkdown(markdown, filename)
  return skillInput(preview.name, preview.instructions)
}

/** Called only for a human-facing turn, never format-constrained helper calls. */
export function appendSkillInstructions(base: string, skills: readonly StudioSkill[], budget?: SkillPromptBudget): string {
  const active = skills.filter(skill => skill.enabled)
  if (!active.length) return base
  const sections = active.map(skill => `### ${JSON.stringify(skill.name)}
${skill.instructions}`)
  const addition = `

## Habilidades ativadas pelo usuário
Estas instruções não concedem permissões de ferramentas nem dispensam confirmações.

${sections.join('\n\n')}`
  const local = budget?.local ?? true
  if ((local && active.reduce((sum, skill) => sum + skill.instructions.length, 0) > ACTIVE_SKILL_TEXT_LIMIT)
      || (budget && estimateTokens(base + addition) > budget.tokens)) {
    throw new Error('As habilidades ativas não cabem no orçamento do modelo selecionado. Desative algumas habilidades ou selecione um modelo com maior contexto. Nenhuma habilidade foi omitida silenciosamente.')
  }
  return base + addition
}
