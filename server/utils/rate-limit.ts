import type { H3Event } from 'h3'

/**
 * Fixed-window in-memory rate limiter for the public + auth endpoints.
 * In-memory is correct here for the same reason as the realtime bus: v1 is a
 * single instance (§5.4). If Perch ever scales horizontally, this file swaps
 * to Redis alongside publish().
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 20_000

function sweep() {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function requestIp(event: H3Event): string {
  return getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
}

/**
 * Throw 429 when `key` exceeds `max` hits in the window. Name-spaces the key
 * so different endpoints never share buckets.
 */
export function assertRateLimit(
  name: string,
  key: string,
  opts: { max: number, windowMs: number }
): void {
  const now = Date.now()
  if (buckets.size > MAX_BUCKETS) sweep()

  const id = `${name}:${key}`
  const bucket = buckets.get(id)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + opts.windowMs })
    return
  }
  bucket.count++
  if (bucket.count > opts.max) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests — slow down and try again shortly'
    })
  }
}
