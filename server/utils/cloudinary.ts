import { createHash } from 'node:crypto'

export { ATTACHMENT_MAX_BYTES } from '@perch/shared'

/**
 * Cloudinary upload helpers (PRD §5.3). The API secret never leaves the
 * server: Perch authenticates the caller and enforces the byte cap before
 * forwarding a short-lived signed upload. Pure helpers are unit-tested.
 */

export const ATTACHMENT_FORMATS = 'jpg,jpeg,png,gif,webp'

export function cloudinaryConfig() {
  const config = useRuntimeConfig()
  return {
    cloudName: (config.cloudinaryCloudName as string) || process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: (config.cloudinaryApiKey as string) || process.env.CLOUDINARY_API_KEY || '',
    apiSecret: (config.cloudinaryApiSecret as string) || process.env.CLOUDINARY_API_SECRET || ''
  }
}

export function cloudinaryUploadAvailable(config: ReturnType<typeof cloudinaryConfig>): boolean {
  return Boolean(config.cloudName && config.apiKey && config.apiSecret)
}

export function imageAttachmentsAvailable(): boolean {
  return cloudinaryUploadAvailable(cloudinaryConfig())
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

/** Extract only public ids produced under Perch's own managed upload folder. */
export function cloudinaryPublicIdFromUrl(url: string, cloudName: string): string | null {
  if (!isOwnCloudinaryImageUrl(url, cloudName)) return null
  try {
    const pathname = decodeURIComponent(new URL(url).pathname)
    const marker = `/${cloudName}/image/upload/`
    const segments = pathname.slice(pathname.indexOf(marker) + marker.length).split('/').filter(Boolean)
    if (segments.some(segment => segment === '.' || segment === '..')) return null
    const versionIndex = segments.findIndex(segment => /^v\d+$/.test(segment))
    const resource = (versionIndex >= 0 ? segments.slice(versionIndex + 1) : segments).join('/')
    if (!resource.startsWith('perch/')) return null
    const publicId = resource.replace(/\.[a-z0-9]+$/i, '')
    return publicId.length <= 255 ? publicId : null
  } catch {
    return null
  }
}
