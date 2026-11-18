import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('sidebar-verification')) return
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
    localStorage.setItem('locally-uncensored-ui', JSON.stringify({ version: 1, state: { sidebarOpen: true, sidebarWidth: 250 } }))
    localStorage.setItem('sidebar-verification', '1')
  })
  await page.goto('http://127.0.0.1:5274/')
  const sidebar = page.getByTestId('sidebar-panel')
  const labels = ['Chat', 'Código', 'Agentes', 'Habilidades', 'Agenda', 'Acesso remoto']
  await expect(sidebar.locator('nav button')).toHaveText(labels)
  for (const name of ['Agentes', 'Habilidades', 'Agenda']) {
    await expect(page.locator('header').getByRole('button', { name, exact: true })).toHaveCount(0)
    await sidebar.getByRole('button', { name, exact: true }).click()
    await expect(sidebar.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(sidebar.getByRole('searchbox')).toBeVisible()
    await expect(sidebar.getByRole('listbox')).toBeAttached()
  }
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click()
  await sidebar.getByRole('button', { name: 'Acesso remoto', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: 'Conectar', exact: true })).toBeVisible()
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click()
  await sidebar.getByRole('searchbox').fill('conversa inexistente')
  await expect(sidebar.getByText('Nenhum resultado', { exact: true })).toBeVisible()
  await sidebar.getByRole('searchbox').fill('')
  const positions = await sidebar.evaluate(element => [element.querySelector('nav'), element.querySelector('input'), element.querySelector('[role="listbox"]')].map(node => node.getBoundingClientRect().top))
  expect(positions[0]).toBeLessThan(positions[1])
  expect(positions[1]).toBeLessThan(positions[2])
  await page.screenshot({ path: 'docs/bionic-preview/42-lateral-navegacao.png', fullPage: true })
  await page.getByTestId('sidebar-toggle').click()
  const rail = page.getByTestId('sidebar-rail')
  await expect(rail.locator('nav button')).toHaveCount(6)
  await rail.getByRole('button', { name: 'Agentes', exact: true }).click()
  await expect(rail.getByRole('button', { name: 'Agentes', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('sidebar-toggle').click()
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.setViewportSize({ width: 600, height: 900 })
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await expect(sidebar.getByRole('searchbox')).toBeVisible()
  await page.screenshot({ path: 'docs/bionic-preview/43-lateral-compacta.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    const blob = JSON.parse(localStorage.getItem('chat-settings'))
    blob.state.settings.interfaceScale = 150
    localStorage.setItem('chat-settings', JSON.stringify(blob))
  })
  await page.reload()
  await expect(sidebar.getByRole('button', { name: 'Acesso remoto', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('searchbox')).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 1440)
  await page.screenshot({ path: 'docs/bionic-preview/44-lateral-zoom150.png', fullPage: true })
  expect(errors).toEqual([])
  console.log('Navegação, ordem, pesquisa, seções persistentes, lateral recolhida, 600 px e zoom 150% verificados.')
} finally { await browser.close() }
