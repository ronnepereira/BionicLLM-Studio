import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } })))
  await page.goto('http://127.0.0.1:5274/')
  await page.locator('aside').getByRole('button', { name: 'Habilidades', exact: true }).click()
  await page.getByRole('tab', { name: 'Conectores', exact: true }).click()
  const ids = ['telegram-connector', 'whatsapp-connector', 'meta-whatsapp-connector', 'google-connector', 'facebook-connector', 'instagram-connector', 'linkedin-connector', 'youtube-connector', 'tiktok-connector', 'mcp-connectors']
  for (const id of ids) {
    const section = page.getByTestId(id)
    await expect(section).toHaveJSProperty('open', false)
    await expect(section.locator('summary')).toBeVisible()
    await expect(section.locator(':scope > div')).toBeHidden()
    await section.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(section).toHaveJSProperty('open', true)
    await expect(section.locator(':scope > div')).toBeVisible()
    // Folding must retain the mounted form, without resetting its local state.
    const before = await section.locator('input').count()
    await section.locator('summary').click()
    await expect(section).toHaveJSProperty('open', false)
    expect(await section.locator('input').count()).toBe(before)
  }
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/26-conectores-sanfona.png', import.meta.url)), fullPage: true })
  await page.setViewportSize({ width: 600, height: 1000 })
  for (const id of ids) await expect(page.getByTestId(id).locator('summary')).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await page.getByTestId('meta-whatsapp-connector').locator('summary').click()
  await expect(page.getByLabel('Token de acesso da Meta', { exact: true })).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  expect(errors).toEqual([])
  console.log(JSON.stringify({ collapsedByDefault: true, keyboard: true, formsRemainMounted: true, compact: true }))
} finally { await browser.close() }
