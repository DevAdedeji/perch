import type { MessageDTO } from '@perch/shared'

export type InboxMessage = MessageDTO & { pending?: boolean, failed?: boolean }
type Attachment = { url: string, type: string }
type Upload = () => Promise<Attachment>
type Send = (message: InboxMessage, clientMessageId: string) => Promise<MessageDTO>
type Listener = (conversationId: string, sent?: { temporaryId: string, message: MessageDTO }) => void

interface PendingSend {
  message: InboxMessage
  clientMessageId: string
  upload?: Upload
  running?: Promise<void>
}

export class InboxOutbox {
  private scope: string | null = null
  private entries = new Map<string, PendingSend>()
  private listeners = new Set<Listener>()

  setScope(scope: string | null) {
    if (scope === this.scope) return
    for (const entry of this.entries.values()) this.releasePreview(entry)
    this.entries.clear()
    this.scope = scope
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pending(conversationId: string): InboxMessage[] {
    return [...this.entries.values()]
      .filter(entry => entry.message.conversation_id === conversationId)
      .map(entry => ({ ...entry.message }))
  }

  acknowledge(message: MessageDTO): boolean {
    if (!message.client_message_id) return false
    const id = `temp-${message.client_message_id}`
    const entry = this.entries.get(id)
    if (!entry || entry.message.conversation_id !== message.conversation_id
      || entry.message.sender_type !== message.sender_type || entry.message.sender_id !== message.sender_id) return false
    this.releasePreview(entry)
    this.entries.delete(id)
    this.notify(message.conversation_id, { temporaryId: id, message })
    return true
  }

  discardConversation(conversationId: string) {
    for (const [id, entry] of this.entries) {
      if (entry.message.conversation_id !== conversationId) continue
      this.releasePreview(entry)
      this.entries.delete(id)
    }
  }

  add(input: {
    conversationId: string
    memberId: string
    content: string
    internalNote: boolean
    mentionedMemberIds?: string[]
    attachment?: Attachment
    upload?: Upload
  }): string {
    if (!this.scope) throw new Error('No inbox identity selected')
    const clientMessageId = crypto.randomUUID()
    const id = `temp-${clientMessageId}`
    const message: InboxMessage = {
      id,
      client_message_id: clientMessageId,
      conversation_id: input.conversationId,
      sender_type: 'agent',
      sender_id: input.memberId,
      content: input.content,
      attachment_url: input.attachment?.url ?? null,
      attachment_type: input.attachment?.type ?? null,
      is_internal_note: input.internalNote,
      mentioned_member_ids: [...(input.mentionedMemberIds ?? [])],
      created_at: new Date().toISOString(),
      pending: true
    }
    this.entries.set(id, { message, clientMessageId, upload: input.upload })
    this.notify(input.conversationId)
    return id
  }

  send(id: string, deliver: Send): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return Promise.resolve()
    if (entry.running) return entry.running
    // Defer execution until the promise is stored, so a second click shares it.
    entry.running = Promise.resolve().then(async () => {
      const current = () => this.entries.get(id) === entry
      if (!current()) return
      entry.message.pending = true
      entry.message.failed = false
      this.notify(entry.message.conversation_id)
      try {
        if (entry.message.attachment_url?.startsWith('blob:')) {
          if (!entry.upload) throw new Error('Upload unavailable')
          const image = await entry.upload()
          if (!current()) return
          this.releasePreview(entry)
          entry.message.attachment_url = image.url
          entry.message.attachment_type = image.type
          entry.upload = undefined
          this.notify(entry.message.conversation_id)
        }
        const message = await deliver({ ...entry.message }, entry.clientMessageId)
        if (!current()) return
        this.entries.delete(id)
        this.notify(entry.message.conversation_id, { temporaryId: id, message })
      } catch {
        if (!current()) return
        entry.message.pending = false
        entry.message.failed = true
        this.notify(entry.message.conversation_id)
      } finally {
        entry.running = undefined
      }
    })
    return entry.running
  }

  private releasePreview(entry: PendingSend) {
    if (entry.message.attachment_url?.startsWith('blob:')) URL.revokeObjectURL(entry.message.attachment_url)
    entry.upload = undefined
  }

  private notify(conversationId: string, sent?: { temporaryId: string, message: MessageDTO }) {
    for (const listener of this.listeners) listener(conversationId, sent)
  }
}

// An app owns its uploads and retries. No metadata is shared between SSR requests.
const outboxes = new WeakMap<object, InboxOutbox>()

export function inboxOutboxFor(app: object): InboxOutbox {
  let outbox = outboxes.get(app)
  if (!outbox) {
    outbox = new InboxOutbox()
    outboxes.set(app, outbox)
  }
  return outbox
}
