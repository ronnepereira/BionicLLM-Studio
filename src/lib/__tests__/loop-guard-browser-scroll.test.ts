import { AgentLoopGuard } from '../agent-loop-guard'

const scroll = (moved: boolean, token: string) => ({
  name: 'browser_action', failed: false,
  args: { action: 'scroll', token, target: 'e1', y: -10000 },
  result: JSON.stringify({ action: 'scroll', token, scroll: { moved } }),
})

describe('browser scroll progress', () => {
  it('steers after two no-op scrolls and halts at six despite fresh tokens and reads', () => {
    const guard = new AgentLoopGuard()
    expect(guard.recordResults([scroll(false, 'one')]).action).toBe('ok')
    expect(guard.recordResults([scroll(false, 'two')]).action).toBe('steer')
    for (let i = 3; i <= 6; i++) {
      guard.recordResults([{ name: 'browser_read', failed: false, result: '{}' }])
      guard.recordResults([{ name: 'browser_action', failed: false, result: '{"action":"wait"}' }])
      expect(guard.recordResults([scroll(false, String(i))]).action).toBe(i === 6 ? 'halt' : 'ok')
    }
  })
  it('allows long scrolling with measured movement and resets after progress', () => {
    const guard = new AgentLoopGuard()
    guard.recordResults([scroll(false, 'one')])
    for (let i = 0; i < 20; i++) expect(guard.recordResults([scroll(true, String(i))]).action).toBe('ok')
    expect(guard.recordResults([scroll(false, 'new')]).action).toBe('ok')
    expect(guard.recordResults([scroll(false, 'newer')]).action).toBe('steer')
  })
  it('ignores rejected and malformed results and resets on navigation', () => {
    const guard = new AgentLoopGuard()
    guard.recordResults([scroll(false, 'one')])
    guard.recordResults([{ ...scroll(false, 'two'), rejected: true }])
    guard.recordResults([{ name: 'browser_action', failed: false, result: 'Error: cancelled' }])
    guard.recordResults([{ name: 'browser_open', failed: false, result: '{"action":"open"}' }])
    expect(guard.recordResults([scroll(false, 'three')]).action).toBe('ok')
  })
  it('detects cycling views despite changing scroll deltas, while reads do not inflate counts', () => {
    const guard = new AgentLoopGuard()
    const view = (y: number, token: string) => ({ ...scroll(true, token), result: JSON.stringify({ action: 'scroll', url: 'https://example.com', scrollY: y, text: y ? 'Código encontrado' : 'Início', scroll: { moved: true } }) })
    for (let pass = 1; pass <= 5; pass++) {
      expect(guard.recordResults([view(0, `top-${pass}`)]).action).toBe(pass === 3 ? 'steer' : pass === 5 ? 'halt' : 'ok')
      if (pass === 5) break
      guard.recordResults([{ name: 'browser_read', failed: false, result: view(0, 'read').result }])
      expect(guard.recordResults([view(1000, `bottom-${pass}`)]).action).toBe(pass === 3 ? 'steer' : 'ok')
    }
  })
  it('does not confuse different page contents at the same position with cycling', () => {
    const guard = new AgentLoopGuard()
    for (let i = 0; i < 20; i++) {
      const result = JSON.stringify({ action: 'scroll', url: 'https://example.com', scrollY: 1000, text: `Resultado ${i}`, scroll: { moved: true } })
      expect(guard.recordResults([{ ...scroll(true, String(i)), result }]).action).toBe('ok')
    }
  })

})
