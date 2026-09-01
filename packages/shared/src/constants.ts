/** Canonical public origin used by production-facing links and examples. */
export const PERCH_PRODUCTION_ORIGIN = 'https://useperch.xyz' as const

/** Shared client/server attachment contract; the server remains authoritative. */
export const ATTACHMENT_MAX_BYTES = 1024 * 1024
export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

/** Keeps one bulk inbox request bounded for locking, audit, and realtime fan-out. */
export const MAX_BULK_CONVERSATIONS = 50

export function validateImageAttachment(file: { type: string, size: number }): string | null {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Use a JPG, PNG, GIF, or WebP image'
  }
  if (file.size > ATTACHMENT_MAX_BYTES) return 'Images must be smaller than 1 MB'
  return null
}
