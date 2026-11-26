import { test, expect } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

for (const surface of ['Chat', 'Code']) {
  test(`${surface} sends the answer to a model clarification`, async ({ page }) => {
    const question = 'Which output format should I use?'
    const questionBlock = ['```studio-question', JSON.stringify({ question, options: ['Markdown', 'PDF'] }), '```'].join('\n')
    const final = 'I can continue with the format you chose.'
    await page.addInitScript(tauriMockInit, {
      modelName: DEFAULT_MODEL_NAME,
      bundledModels: [{ name: DEFAULT_MODEL_NAME, size: 5_000_000_000 }],
      assistantReply: questionBlock,
      agentTurns: [{ text: questionBlock }, { text: final }],
    })
    await seedOnboardingDone(page)
    await page.goto('/')
    if (surface === 'Code') await page.getByRole('button', { name: 'Código', exact: true }).click()
    const composer = page.locator('textarea[data-lu-composer]')
    const picker = page.getByRole('button', { name: 'Selecione o modelo de chat' })
    await picker.click()
    await page.getByRole('button', { name: /^Qwen \(1\)$/ }).click()
    await page.getByText(/qwen2\.5.*7b.*instruct/i).last().click()
    await composer.fill('Create a report and ask me which format to use.')
    await composer.press('Enter')

    const card = page.getByRole('region', { name: question })
    await expect(card).toBeVisible()
    if (surface === 'Code') {
      await card.getByRole('textbox', { name: 'Digite sua resposta' }).fill('Plain text')
      await card.getByRole('button', { name: 'Enviar resposta' }).click()
    } else {
      await card.getByRole('button', { name: 'PDF' }).click()
    }
    const answer = surface === 'Code' ? 'Plain text' : 'PDF'
    await expect(page.getByText(final)).toBeVisible()
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('main').getByText(question, { exact: true })).toBeVisible()
    const recorded = await page.evaluate(() => (window as unknown as { __E2E_CHAT_BODIES__: string[] }).__E2E_CHAT_BODIES__)
    const first = JSON.parse(recorded[0])
    expect(first.messages[0].content).toContain('studio-question')
    expect(first.messages[0].content).toContain('Configurações → Geral → Aparência → Tamanho da fonte do chat')
    const reply = JSON.parse(recorded.at(-1)!)
    expect(reply.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining(question) }),
      expect.objectContaining({ role: 'user', content: expect.stringContaining(answer) }),
    ]))
  })
}
