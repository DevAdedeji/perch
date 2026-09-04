import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWidget } from '../app/composables/useWidget'

const { ref }: typeof import('vue') = createRequire(import.meta.resolve('nuxt/package.json'))('vue')

function response() {
  return {
    conversation_id: 'conversation-a',
    message: { id: 'saved-message', conversation_id: 'conversation-a', sender_type: 'visitor', content: 'Hello', attachment_url: null, attachment_type: null, created_at: '2026-09-05T10:00:00Z' }
  }
}

function harness() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('document', { referrer: 'https://example.test/pricing' })
  const fetch = vi.fn().mockResolvedValue(response())
  vi.stubGlobal('$fetch', fetch)
  return { widget: useWidget('test-site', 'test-ticket'), fetch }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('widget send recovery', () => {
  it('retries with the same request ID and original prechat consent after a lost response', async () => {
    const { widget, fetch } = harness()
    fetch.mockRejectedValueOnce(new Error('Response lost'))
    await expect(widget.sendMessage('Hello', { name: 'Visitor', email: 'visitor@example.test', replyEmailConsent: true })).rejects.toThrow('Response lost')
    const temporary = widget.messages.value[0]!
    expect(temporary.failed).toBe(true)
    await widget.retrySend(temporary.id)
    const first = fetch.mock.calls[0]![1].body
    const second = fetch.mock.calls[1]![1].body
    expect(first.client_message_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.client_message_id).toBe(first.client_message_id)
    expect(second.reply_email_consent).toBe(true)
    expect(second.email).toBe('visitor@example.test')
    expect(widget.messages.value.map(message => message.id)).toEqual(['saved-message'])
  })

  it('ignores concurrent retries of a message whose send is still pending', async () => {
    const { widget, fetch } = harness()
    let resolve!: (value: ReturnType<typeof response>) => void
    fetch.mockReturnValueOnce(new Promise((done) => {
      resolve = done
    }))
    const pending = widget.sendMessage('Hello')
    await Promise.resolve()
    await widget.retrySend(widget.messages.value[0]!.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    resolve(response())
    await pending
    expect(widget.messages.value).toHaveLength(1)
  })

  it('does not report a failed send after realtime already acknowledged the same request', async () => {
    const { widget, fetch } = harness()
    let reject!: (error: Error) => void
    fetch.mockReturnValueOnce(new Promise((_resolve, fail) => {
      reject = fail
    }))
    const pending = widget.sendMessage('Hello')
    await Promise.resolve()
    const clientMessageId = widget.messages.value[0]!.client_message_id
    widget.messages.value = [{ ...response().message, sender_type: 'visitor', client_message_id: clientMessageId }]
    reject(new Error('HTTP response lost after realtime delivery'))
    await expect(pending).resolves.toBeUndefined()
    expect(widget.messages.value).toHaveLength(1)
    expect(widget.messages.value[0]!.failed).toBeUndefined()
  })

  it('does not post an uploaded image after the widget has stopped', async () => {
    const { widget, fetch } = harness()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let resolve!: (value: { url: string, type: string }) => void
    const upload = vi.fn(() => new Promise<{ url: string, type: string }>((done) => {
      resolve = done
    }))
    const pending = widget.sendAttachment(new File(['image'], 'example.png', { type: 'image/png' }), upload)
    widget.stop()
    resolve({ url: 'https://images.example.test/uploaded.png', type: 'image/png' })
    await pending
    expect(fetch).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:local-test')
  })
})
