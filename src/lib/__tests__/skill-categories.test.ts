import { describe, it, expect } from 'vitest'
import { skillCategoryFor, skillCategoryCounts } from '../skill-categories'
import { parseSkillMarkdown, previewSkillMarkdown } from '../skills'
import { useSkillStore } from '../../stores/skillStore'

describe('skill categories do not change instructions or activation', () => {
  it.each([['frontend-design', 'code'], ['Code review', 'code'], ['Pesquisa de fontes', 'research'], ['Clear writing', 'writing'], ['ad-creative', 'marketing'], ['spreadsheets', 'data'], ['imagegen', 'media'], ['computer-use', 'system'], ['Agenda pessoal', 'productivity'], ['Nome desconhecido', 'other']])('%s has a useful automatic category', (name, expected) => {
    expect(skillCategoryFor({ name })).toBe(expected)
  })
  it('honors a manual category and ignores invalid categories', () => {
    expect(skillCategoryFor({ name: 'Python', category: 'writing' })).toBe('writing')
    expect(skillCategoryFor({ name: 'Python', category: 'unknown' })).toBe('code')
  })
  it('counts without dropping uncategorized and disabled items', () => {
    expect(skillCategoryCounts([{ name: 'Python' }, { name: 'Rust' }, { name: 'ABC' }])).toEqual({ all: 3, code: 2, other: 1 })
  })
  it('sets and clears a manual category while preserving runtime content', () => {
    useSkillStore.setState({ skills: [{ id: 'category-proof', name: 'Python', instructions: 'Conteúdo original', enabled: true }] })
    useSkillStore.getState().setCategory('category-proof', 'writing')
    expect(useSkillStore.getState().skills[0]).toMatchObject({ category: 'writing', instructions: 'Conteúdo original', enabled: true })
    useSkillStore.getState().setCategory('category-proof', undefined)
    expect(skillCategoryFor(useSkillStore.getState().skills[0])).toBe('code')
  })
})

it('can read a full library without the old fixed activation/import limit', () => {
  const original = '# Biblioteca extensa\n' + 'x'.repeat(20_000)
  expect(previewSkillMarkdown(original, 'SKILL.md').instructions).toBe(original)
  expect(parseSkillMarkdown(original, 'SKILL.md').instructions).toBe(original)
})
