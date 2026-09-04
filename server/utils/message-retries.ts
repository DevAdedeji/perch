import { createHash } from 'node:crypto'

export interface MessagePayload {
  content: string
  attachmentUrl?: string | null
  attachmentType?: string | null
  isInternalNote?: boolean
  mentionRecipientIds?: string[]
}

export function messageFingerprint(input: MessagePayload): string {
  return createHash('sha256').update(JSON.stringify({
    content: input.content,
    attachmentUrl: input.attachmentUrl ?? null,
    attachmentType: input.attachmentType ?? null,
    isInternalNote: input.isInternalNote ?? false,
    mentionRecipientIds: [...new Set(input.mentionRecipientIds ?? [])].sort()
  })).digest('hex')
}

export function assertSameMessage(existingFingerprint: string | null, fingerprint: string): void {
  if (existingFingerprint !== fingerprint) {
    throw createError({ statusCode: 409, statusMessage: 'This message request was already used for different content' })
  }
}
