/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import EmojiPicker from '../EmojiPicker'
vi.mock('../../../api/backend', () => ({ isTauri: () => false, isMobile: () => false, openExternal: vi.fn() }))
vi.mock('../comfyViewRescue', () => ({ useComfyViewRescue: () => null, isInlineVideoUrl: () => false }))
afterEach(cleanup)

it('shows color swatches in prose, inline code and tables without changing source blocks or links', () => {
  const { container } = render(<MarkdownRenderer content={'Fundo: #F0F0F0 / #E0E0E0; azul `#0030A0`; rgb(0, 48, 160); hsl(240, 100%, 50%).\n\n```css\n.box { color: #F0C000 }\n```\n\n[Cor](https://example.com/#0030A0)'} />)
  expect(container.querySelectorAll('.chat-color-swatch')).toHaveLength(5)
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/#0030A0')
  expect(container.textContent).toContain('#F0C000')
})

it('renders generated HTML/CSS in an isolated static preview with accessible source', () => {
  const { container, getByText } = render(<MarkdownRenderer content={'```html\n<style>button{background:#0030A0;color:white}</style><button>Teste</button><script>parent.hacked=true</script>\n```'} />)
  const frame = container.querySelector('iframe')!
  expect(frame).toBeTruthy()
  expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
  expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
  expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'")
  expect(getByText('Ver código HTML/CSS')).toBeTruthy()
})

it('finds and inserts the Brazilian flag from the Portuguese catalog', () => {
  const select = vi.fn()
  const { getByLabelText } = render(<EmojiPicker onSelect={select} onClose={() => {}} />)
  fireEvent.change(getByLabelText('Buscar emoji'), { target: { value: 'brasil' } })
  fireEvent.click(getByLabelText('bandeira: Brasil'))
  expect(select).toHaveBeenCalledWith('🇧🇷')
})
