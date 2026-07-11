import { createHash } from 'node:crypto'

/**
 * Cloudinary signed uploads (PRD §5.3). The API secret never leaves the
 * server: clients ask /api/attachments/sign for a signature, upload straight
 * to Cloudinary with it, and send the returned secure_url as the message
 * attachment. Pure helpers unit-tested in test/cloudinary.test.ts.
 */

export const ATTACHMENT_MAX_BYTES = 1024 * 1024 // 1 MB
export const ATTACHMENT_FORMATS = 'jpg,jpeg,png,gif,webp'

export function cloudinaryConfig() {
  const config = useRuntimeConfig()
  return {
    cloudName: (config.cloudinaryCloudName as string) || process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: (config.cloudinaryApiKey as string) || process.env.CLOUDINARY_API_KEY || '',
    apiSecret: (config.cloudinaryApiSecret as string) || process.env.CLOUDINARY_API_SECRET || ''
  }
}

/** Cloudinary's signature scheme: sha1 over the sorted `k=v&…` params + secret. */
export function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1').update(toSign + apiSecret).digest('hex')
}

/**
 * A message attachment URL must be an https image delivery URL on OUR cloud —
 * anything else is rejected at the message endpoints (no hotlinking arbitrary
 * hosts into threads).
 */
export function isOwnCloudinaryImageUrl(url: string, cloudName: string): boolean {
  if (!cloudName) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
      && u.hostname === 'res.cloudinary.com'
      && u.pathname.startsWith(`/${cloudName}/image/upload/`)
  } catch {
    return false
  }
}
