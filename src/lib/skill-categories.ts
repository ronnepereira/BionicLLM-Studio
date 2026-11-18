export const SKILL_CATEGORIES = [
  { id: 'code', label: 'Código e desenvolvimento' },
  { id: 'research', label: 'Pesquisa' },
  { id: 'writing', label: 'Escrita e conteúdo' },
  { id: 'marketing', label: 'Marketing e vendas' },
  { id: 'data', label: 'Dados e análise' },
  { id: 'productivity', label: 'Produtividade' },
  { id: 'media', label: 'Imagem, áudio e vídeo' },
  { id: 'system', label: 'Sistema e automação' },
  { id: 'other', label: 'Outras habilidades' },
] as const
export type SkillCategory = typeof SKILL_CATEGORIES[number]['id']
export type SkillCategoryFilter = SkillCategory | 'all'
export function isSkillCategory(value: unknown): value is SkillCategory {
  return SKILL_CATEGORIES.some(category => category.id === value)
}
export function skillCategoryFor(skill: { name: string; description?: string; templateId?: string; category?: string }): SkillCategory {
  if (isSkillCategory(skill.category)) return skill.category
  const templates: Record<string, SkillCategory> = { 'code-review': 'code', research: 'research', writing: 'writing' }
  if (skill.templateId && templates[skill.templateId]) return templates[skill.templateId]
  const text = (skill.name + ' ' + (skill.description || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]/g, ' ')
  const rules: [SkillCategory, RegExp][] = [
    ['marketing', /\b(marketing|seo|ads|ad creative|advertising|campaign|campanha|sales|vendas|pricing|prospecting|referrals|paywalls|copywriting|ab testing|lead magnets|cold email|social media|growth|conversion|cro|aso)\b/],
    ['code', /\b(code|codigo|coding|developer|desenvolvimento|frontend|backend|programming|programacao|rust|python|javascript|typescript|software|debug|sdk|git|tests|testing)\b/],
    ['media', /\b(image|images|imagem|imagens|imagegen|audio|video|photos|photo|music|musica|hologram|animation|animacao)\b/],
    ['data', /\b(data|dados|analytics|analysis|analise|spreadsheet|spreadsheets|planilha|planilhas|excel|csv|sql|database|estatistica)\b/],
    ['research', /\b(research|pesquisa|sources|fontes|search|busca|investigacao)\b/],
    ['writing', /\b(writing|escrita|write|redacao|revisao|translate|traducao|content|conteudo|text|texto|editorial)\b/],
    ['system', /\b(system|sistema|automation|automacao|computer|terminal|shell|browser|navegador|scraper|scraping|backup|orchestration|orquestracao)\b/],
    ['productivity', /\b(productivity|produtividade|calendar|calendario|agenda|email|gmail|drive|document|documents|pdf|presentation|presentations|task|tasks|tarefas|notes|notas|memory|memoria)\b/],
  ]
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other'
}
export function skillCategoryLabel(category: SkillCategory): string {
  return SKILL_CATEGORIES.find(item => item.id === category)!.label
}

export function skillCategoryCounts(skills: Parameters<typeof skillCategoryFor>[0][]): Partial<Record<SkillCategoryFilter, number>> {
  const counts: Partial<Record<SkillCategoryFilter, number>> = { all: skills.length }
  for (const skill of skills) { const category = skillCategoryFor(skill); counts[category] = (counts[category] || 0) + 1 }
  return counts
}
