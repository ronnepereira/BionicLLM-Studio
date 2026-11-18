import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = [], telegramRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).hostname === 'api.telegram.org') telegramRequests.push(request.url()) })
  await page.addInitScript(() => {
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
  })
  await page.goto('http://127.0.0.1:5274/')
  await page.locator('aside').getByRole('button', { name: 'Habilidades', exact: true }).click()
  await page.getByRole('tab', { name: 'Conectores', exact: true }).click()
  const panel = page.getByTestId('telegram-connector')
  await panel.locator('summary').click()
  await expect(page.getByRole('heading', { name: 'Integrações nativas', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Conectores MCP', exact: true })).toBeVisible()
  await expect(panel.getByLabel('Token do bot')).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Verificar e salvar', exact: true })).toBeDisabled()
  await expect(panel.getByText(/Modo de revisão: o agente prepara rascunhos/)).toBeVisible()
  await expect(panel.getByLabel('Agente responsável', { exact: true })).toBeDisabled()
  await expect(panel.getByLabel('IDs dos chats permitidos', { exact: true })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Ativar receptor', exact: true })).toBeDisabled()
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/20-telegram-conector.png', import.meta.url)), fullPage: true })
  await panel.getByRole('button', { name: 'Ativar receptor', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/21-telegram-receptor.png', import.meta.url)), fullPage: true })
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await expect(panel.getByLabel('Token do bot')).toBeVisible()
  expect(telegramRequests).toEqual([])
  expect(errors).toEqual([])
  console.log(JSON.stringify({ portuguese: true, mcpPreserved: true, browserCannotCollectCredentials: true, noTelegramRequests: true, compactLayout: true }))
} finally { await browser.close() }
