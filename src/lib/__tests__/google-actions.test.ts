import { expect, it } from 'vitest'
import { localGoogleDate } from '../google-actions'
it('converts local wall time with the computer offset and rejects invalid or normalized dates', () => {
  expect(localGoogleDate('2026-11-03T10:30')).toBe(new Date(2026, 10, 3, 10, 30).toISOString())
  expect(() => localGoogleDate('2026-02-30T10:00')).toThrow()
  expect(() => localGoogleDate('2026-11-03T25:00')).toThrow()
  expect(() => localGoogleDate('2026-11-03')).toThrow()
})
