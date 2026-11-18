import { chromium, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('about-verification')) return
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
    localStorage.setItem('locally-uncensored-ui', JSON.stringify({ version: 1, state: { sidebarOpen: true, sidebarWidth: 250 } }))
    localStorage.setItem('about-verification', '1')
  })
  await page.goto('http://127.0.0.1:5274/')
  await page.locator('header').getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Sobre', exact: true }).click()
  const about = page.getByTestId('about-settings')
  await expect(about.getByText(`Versão ${version}`, { exact: true })).toBeVisible()
  await expect(about.getByText('Ronne Pereira', { exact: true })).toBeVisible()
  await expect(about.getByText('ronne.pereira@gmail.com', { exact: true })).toBeVisible()
  const link = about.getByRole('link', { name: 'Pague um café — US$ 5', exact: true })
  await expect(link).toBeVisible()
  const url = new URL(await link.getAttribute('href'))
  expect(url.origin).toBe('https://www.paypal.com')
  expect(url.searchParams.get('business')).toBe('ronne.pereira@gmail.com')
  expect(url.searchParams.get('currency_code')).toBe('USD')
  expect(url.searchParams.get('amount')).toBe('5.00')
  // Let the existing section entrance finish before capturing the UI.
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'docs/bionic-preview/46-configuracoes-sobre.png', fullPage: true })
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect(link).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  await page.screenshot({ path: 'docs/bionic-preview/48-sobre-compacto.png', fullPage: true })
  expect(errors).toEqual([])
  console.log('Sobre: versão, autor, e-mail, destinatário PayPal, US$ 5 e layout compacto verificados. Nenhum pagamento iniciado.')
} finally { await browser.close() }
