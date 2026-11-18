import { describe, it, expect } from 'vitest'
import { buttonColorTokens, normalizeButtonColor, DEFAULT_BUTTON_COLOR } from '../accent-color'
import { contrast } from '../../components/__tests__/wcag-contrast'

describe('custom button colors', () => {
  it('accepts only opaque hex colors and safely backfills old settings', () => {
    for (const value of [undefined, null, 123, '', '#fff', 'red', '#12345678', 'url(x)', '#123456;']) {
      expect(normalizeButtonColor(value)).toBe(DEFAULT_BUTTON_COLOR)
    }
    expect(normalizeButtonColor('#AbC123')).toBe('#abc123')
  })

  it.each(['#1f6feb', '#ffffff', '#000000', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#888888'])(
    'keeps filled and tonal button text readable for %s', (color) => {
      const tokens = buttonColorTokens(color)
      expect(tokens['--color-lu-accent']).toBe(color)
      for (const background of [color, tokens['--color-lu-accent-hover']]) {
        expect(contrast(background, tokens['--color-lu-on-accent'])).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(tokens['--color-lu-accent-ink'], '#bfbfbf')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(tokens['--color-lu-accent-text'], '#555555')).toBeGreaterThanOrEqual(4.5)
    },
  )
})
