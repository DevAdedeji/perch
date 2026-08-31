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
  if (!consumeRateLimit(name, key, opts)) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests — slow down and try again shortly'
    })
  }
}

export function consumeRateLimit(
  name: string,
  key: string,
  opts: { max: number, windowMs: number }
): boolean {
  const now = Date.now()
  const id = `${name}:${key}`
  let bucket = buckets.get(id)

  if (bucket?.resetAt && bucket.resetAt <= now) {
    buckets.delete(id)
    bucket = undefined
  }
  if (!bucket && buckets.size >= MAX_BUCKETS) {
    sweep()
    // Map preserves insertion order. Expired buckets are removed first; if a
    // botnet still fills the cap, evict the oldest live bucket instead of
    // allowing attacker-controlled keys to grow memory without bound.
    while (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  if (!bucket) {
    buckets.set(id, { count: 1, resetAt: now + opts.windowMs })
    return true
  }
  bucket.count++
  return bucket.count <= opts.max
}
