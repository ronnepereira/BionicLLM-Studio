// Isolated test profile: no real account, model inference or external messages.
import { chromium, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const catalog = JSON.parse(readFileSync(new URL('../src/lib/locales/pt-BR.json', import.meta.url), 'utf8'))
const t = source => catalog[source] ?? source
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('bionic-schedule-test-seeded')) return
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
    localStorage.setItem('bionic-agent-profiles-v1', JSON.stringify({ version: 0, state: { profiles: [{ id: 'test-researcher', name: 'Pesquisador de fontes', instructions: 'Pesquise as fontes fornecidas e explique o resultado.', model: 'openai::modelo-de-teste' }] } }))
    localStorage.setItem('bionic-schedule-test-seeded', 'true')
  })
  await page.goto('http://127.0.0.1:5274/')
  const nav = () => page.locator('header').first()
  const agenda = async () => {
    await page.locator('aside').getByRole('button', { name: 'Agenda', exact: true }).click()
    await page.getByRole('heading', { name: t('Task scheduler'), exact: true }).waitFor()
  }
  await agenda()
  await expect(page.getByText(t('No scheduled tasks yet.'), { exact: true })).toBeVisible()
  async function create(name, kind) {
    await page.getByRole('button', { name: t('New schedule'), exact: true }).click()
    await page.getByLabel(t('Task name'), { exact: true }).fill(name)
    await page.getByLabel(t('Agent'), { exact: true }).selectOption('test-researcher')
    await page.getByLabel(t('Task instructions'), { exact: true }).fill('Analise as fontes fornecidas. Não envie mensagens sem confirmação.')
    await page.getByLabel(t('Frequency'), { exact: true }).selectOption(kind)
    await page.getByLabel(t('Time zone'), { exact: true }).fill('America/Sao_Paulo')
    if (kind === 'once') await page.getByLabel(t('Date and time in the selected time zone')).fill('2035-11-02T14:25')
    if (kind === 'weekly') {
      await page.getByLabel(t('Time in the selected time zone')).fill('08:35')
      await page.getByLabel(t('Tuesday'), { exact: true }).uncheck()
      await page.getByLabel(t('Thursday'), { exact: true }).uncheck()
    }
    if (kind === 'interval') await page.getByLabel(t('Repeat every (minutes)')).fill('10000')
    await page.getByRole('button', { name: t('Save schedule'), exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await create('Pesquisa com data definida', 'once')
  await create('Revisão nas segundas, quartas e sextas', 'weekly')
  await create('Verificação por intervalo', 'interval')
  const first = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Pesquisa com data definida', exact: true }) })
  await first.getByRole('button', { name: t('Pause schedule'), exact: true }).click()
  await expect(first.getByRole('button', { name: t('Resume schedule'), exact: true })).toBeVisible()
  await page.reload()
  await agenda()
  await expect(page.getByRole('heading', { name: 'Pesquisa com data definida', exact: true })).toBeVisible()
  await first.getByRole('button', { name: t('Resume schedule'), exact: true }).click()
  await expect(first.getByRole('button', { name: t('Pause schedule'), exact: true })).toBeVisible()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bionic-schedules-v1')))
  expect(stored.items).toHaveLength(3)
  expect(stored.items[1].rule).toEqual({ kind: 'weekly', time: '08:35', days: [1, 3, 5] })
  expect(stored.items[0].nextAt).toBe(Date.parse('2035-11-02T17:25:00Z'))
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/08-agenda.png', import.meta.url)), fullPage: true, animations: 'disabled' })
  const last = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Verificação por intervalo', exact: true }) })
  await last.getByRole('button', { name: 'Remover Verificação por intervalo', exact: true }).click()
  await expect(last).toBeVisible()
  await last.getByRole('button', { name: 'Remover Verificação por intervalo', exact: true }).click()
  await expect(last).toHaveCount(0)
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await page.getByRole('button', { name: t('New schedule'), exact: true }).click()
  await expect(page.getByLabel(t('Task instructions'), { exact: true })).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/09-agenda-compacta.png', import.meta.url)), fullPage: true, animations: 'disabled' })
  expect(errors).toEqual([])
  console.log('Agenda: criação nas três frequências, fuso, dias, pausa/retomada, persistência, remoção e formulário a 600 px verificados. Sem inferência ou mensagens externas.')
} finally { await browser.close() }
