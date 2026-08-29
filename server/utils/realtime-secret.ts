import type { H3Event } from 'h3'

const MIN_REALTIME_SECRET_LENGTH = 32

interface RealtimeSecretSources {
  runtimeSecret?: unknown
  realtimeSecret?: string
  sessionSecret?: string
}

/** Select one signing secret consistently and reject explicitly weak configuration. */
export function resolveRealtimeSecret(sources: RealtimeSecretSources): string | null {
  const selected = [sources.runtimeSecret, sources.realtimeSecret, sources.sessionSecret]
    .find(value => typeof value === 'string' && value.length > 0)

  return typeof selected === 'string' && selected.trim().length >= MIN_REALTIME_SECRET_LENGTH
    ? selected
    : null
}

export function realtimeSecret(event?: H3Event): string | null {
  return resolveRealtimeSecret({
    runtimeSecret: useRuntimeConfig(event).realtimeSecret,
    realtimeSecret: process.env.REALTIME_SECRET,
    sessionSecret: process.env.NUXT_SESSION_PASSWORD
  })
}

export function requireRealtimeSecret(event?: H3Event): string {
  const secret = realtimeSecret(event)
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Realtime is not configured' })
  }
  return secret
}
