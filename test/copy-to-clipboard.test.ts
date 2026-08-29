import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCopyToClipboard } from '../app/composables/useCopyToClipboard'

describe('useCopyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies text and shows consistent success feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const add = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('useToast', () => ({ add }))

    const { copy } = useCopyToClipboard()

    await expect(copy('invite-url', 'Invite link copied')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('invite-url')
    expect(add).toHaveBeenCalledWith({
      title: 'Invite link copied',
      icon: 'i-lucide-check',
      color: 'success'
    })
  })

  it('reports clipboard failures without throwing', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    const add = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('useToast', () => ({ add }))

    const { copy } = useCopyToClipboard()

    await expect(copy('secret')).resolves.toBe(false)
    expect(add).toHaveBeenCalledWith({ title: 'Copy failed', color: 'error' })
  })
})
