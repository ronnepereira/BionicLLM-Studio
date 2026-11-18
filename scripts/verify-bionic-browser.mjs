import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const catalog = JSON.parse(readFileSync(new URL('../src/lib/locales/pt-BR.json', import.meta.url), 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (!localStorage.getItem('bionic-browser-ui-test')) {
      localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
      localStorage.setItem('bionic-browser-ui-test', 'true')
    }
  })
  await page.goto('http://127.0.0.1:5274/')
  const globe = page.locator('header').getByRole('button', { name: 'Navegador interno', exact: true })
  await expect(globe).toBeVisible()
  const downloads = page.locator(`header button[title="${catalog.Downloads ?? 'Downloads'}"]`)
  const [downloadBounds, globeBounds] = await Promise.all([downloads.boundingBox(), globe.boundingBox()])
  expect(downloadBounds.x).toBeLessThan(globeBounds.x)
  expect(globeBounds.x - downloadBounds.x).toBeLessThan(60)
  await globe.click()
  const panel = page.getByRole('complementary', { name: 'Navegador interno', exact: true })
  await expect(panel).toBeVisible()
  await expect(globe).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByText('A navegação está disponível no aplicativo desktop para Windows. Esta prévia web mostra apenas o layout do painel dividido.')).toBeVisible()
  const [chat, pane] = await Promise.all([page.locator('main').boundingBox(), panel.boundingBox()])
  expect(chat.x + chat.width).toBeLessThanOrEqual(pane.x)
  await panel.getByRole('textbox', { name: 'Endereço do site', exact: true }).fill('google.com')
  await panel.getByRole('textbox', { name: 'Endereço do site', exact: true }).press('Enter')
  await expect(panel.getByRole('alert')).toContainText('aplicativo desktop')
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/10-navegador-painel.png', import.meta.url)), fullPage: true, animations: 'disabled' })
  await panel.getByRole('button', { name: 'Fechar painel do navegador', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await globe.click()
  await page.setViewportSize({ width: 600, height: 1000 })
  const [smallChat, smallPanel] = await Promise.all([page.locator('main').boundingBox(), panel.boundingBox()])
  expect(smallChat.height).toBeGreaterThan(100)
  expect(smallPanel.y).toBeGreaterThanOrEqual(smallChat.y + smallChat.height)
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/11-navegador-compacto.png', import.meta.url)), fullPage: true, animations: 'disabled' })
  expect(errors).toEqual([])
  console.log('Globo ao lado das transferências, painel lado a lado, fechar/reabrir e divisão vertical a 600 px verificados. A prévia não simula navegação nativa.')
} finally { await browser.close() }
