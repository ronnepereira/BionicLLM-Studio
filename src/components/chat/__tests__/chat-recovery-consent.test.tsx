// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const recovery = vi.hoisted(() => ({ restore: vi.fn() }))
vi.mock('../../../lib/chat-backup-recovery', () => ({ restoreMissingBackupChats: recovery.restore }))
vi.mock('../../../api/backend', () => ({ isTauri: () => true }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => (s: string) => s }))
import { ChatRecoveryNotice } from '../ChatRecoveryNotice'
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('loads nondeleted history automatically on each launch without restore/dismiss prompts', async () => {
  recovery.restore.mockResolvedValue(4)
  const { unmount } = await act(async () => render(<ChatRecoveryNotice ready={Promise.resolve()} />))
  expect(recovery.restore).toHaveBeenCalledExactlyOnceWith(false)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('complementary')).toBeNull()
  unmount()
  await act(async () => { render(<ChatRecoveryNotice ready={Promise.resolve()} />) })
  expect(recovery.restore).toHaveBeenCalledTimes(2)
  expect(recovery.restore.mock.calls.every(([includeDeleted]) => includeDeleted === false)).toBe(true)
})
it('waits for startup hydration before merging history', async () => {
  recovery.restore.mockResolvedValue(0)
  let ready!: () => void
  const gate = new Promise<void>(resolve => { ready = resolve })
  render(<ChatRecoveryNotice ready={gate} />)
  expect(recovery.restore).not.toHaveBeenCalled()
  await act(async () => { ready() })
  expect(recovery.restore).toHaveBeenCalledExactlyOnceWith(false)
})
it('offers retry only after a real storage failure and keeps deleted chats excluded', async () => {
  recovery.restore.mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce(1)
  await act(async () => { render(<ChatRecoveryNotice ready={Promise.resolve()} />) })
  expect(screen.getByRole('alert').textContent).toContain('local backup was preserved')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
  expect(recovery.restore).toHaveBeenNthCalledWith(2, false)
  expect(screen.queryByRole('alert')).toBeNull()
})
