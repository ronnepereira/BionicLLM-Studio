/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { openExternal } from '../../../api/backend'
vi.mock('../../../api/backend', () => ({ openExternal: vi.fn() }))
vi.mock('../comfyViewRescue', () => ({ useComfyViewRescue: () => null, isInlineVideoUrl: () => false }))
afterEach(cleanup)
it('keeps loose list numbering, paragraphs and long links as inline text', () => {
  const url = 'https://example.com/' + 'long-path-'.repeat(40)
  const { container } = render(<MarkdownRenderer content={`3. **Notícia** — Texto longo.\n\n   🔗 ${url}\n\n4. Outra notícia.\n\n   Segundo parágrafo.`} />)
  const list = container.querySelector('ol')!
  expect(list.start).toBe(3)
  expect(list.className).toContain('list-outside')
  expect(list.querySelectorAll(':scope > li')).toHaveLength(2)
  const link = list.querySelector('a')!
  expect(link.getAttribute('href')).toBe(url)
  expect(link.textContent).toBe(url)
  expect(list.querySelector('button')).toBeNull()
  fireEvent.click(link)
  expect(openExternal).toHaveBeenCalledWith(url)
})
it('preserves GFM table alignment and explicit paragraphs and line breaks', () => {
  const { container } = render(<MarkdownRenderer content={'| Nome | Valor |\n| :--- | ---: |\n| Um | 12 |\n\nPrimeiro parágrafo.\n\nSegundo  \ncom quebra.'} />)
  expect(container.querySelectorAll('th')).toHaveLength(2)
  expect(container.querySelectorAll('th')[1].style.textAlign).toBe('right')
  expect(container.querySelectorAll('td')[1].style.textAlign).toBe('right')
  expect(container.querySelectorAll('p')).toHaveLength(2)
  expect(container.querySelector('br')).toBeTruthy()
})
