import { it, expect } from 'vitest'
import { INTERFACE_SCALES, normalizeInterfaceScale } from '../interface-scale'

it('preserves the current scale for old or invalid settings and accepts the supported choices', () => {
  for (const value of [undefined, null, '125', NaN, 0, -100, 500]) expect(normalizeInterfaceScale(value)).toBe(115)
  for (const value of INTERFACE_SCALES) expect(normalizeInterfaceScale(value)).toBe(value)
})
