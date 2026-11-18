/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExternalImagePreview } from '../ExternalImagePreview'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { useSettingsStore } from '../../../stores/settingsStore'

vi.mock('../../../api/backend', () => ({ openExternal: vi.fn() }))
vi.mock('../comfyViewRescue', () => ({ useComfyViewRescue: () => null, isInlineVideoUrl: (s: string) => s.endsWith('.mp4') }))
beforeEach(() => useSettingsStore.getState().updateSettings({ externalImagePreviews: false }))
afterEach(() => cleanup())

describe('external references stay separate from generation', () => {
  it('does not fetch before consent and offers a 500px responsive thumbnail and original link', () => {
    const view = render(<ExternalImagePreview src="https://example.com/a.jpg" alt="Referência" />)
    expect(view.container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Carregar miniatura' }))
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/a.jpg')
    expect(screen.getByRole('img').getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByRole('button', { name: /Abrir imagem original/ })).toBeTruthy()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Fonte:')).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Abrir imagem original/ })).toBeTruthy()
  })
  it('respects automatic opt-in and revocation', () => {
    useSettingsStore.getState().updateSettings({ externalImagePreviews: true })
    const view = render(<ExternalImagePreview src="https://example.com/a.jpg" alt="Referência" />)
    expect(screen.getByRole('img')).toBeTruthy()
    view.unmount()
    useSettingsStore.getState().updateSettings({ externalImagePreviews: false })
    render(<ExternalImagePreview src="https://example.com/a.jpg" alt="Referência" />)
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('renders direct links and linked markdown images without nested buttons', () => {
    const { container } = render(<MarkdownRenderer content={'[Referência](https://example.com/a.jpg)\n\n[![Outra referência](https://example.com/b.jpg)](https://example.com/source)'} />)
    expect(screen.getAllByRole('button', { name: 'Carregar miniatura' })).toHaveLength(2)
    expect(container.querySelector('button button')).toBeNull()
    expect(screen.getByRole('button', { name: /Abrir página de origem/ })).toBeTruthy()
  })
  it('keeps local generated image and video rendering on the existing path', () => {
    const { container } = render(<MarkdownRenderer content={'![Gerada](http://127.0.0.1:8188/view?filename=a.png)\n\n![Vídeo](http://127.0.0.1:8188/clip.mp4)'} />)
    expect(screen.getByAltText('Gerada').getAttribute('src')).toContain('/view?filename=a.png')
    expect(container.querySelector('video[controls]')).toBeTruthy()
    expect(screen.queryByTestId('external-image-preview')).toBeNull()
  })
})
