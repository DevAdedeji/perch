type UnknownRecord = Record<string, unknown>

interface BreadcrumbLike extends UnknownRecord {
  category?: string
  data?: UnknownRecord
  message?: string
}

interface SentryEventLike extends UnknownRecord {
  breadcrumbs?: BreadcrumbLike[]
  contexts?: UnknownRecord
  exception?: { values?: Array<UnknownRecord> }
  message?: string
  request?: UnknownRecord
  spans?: UnknownRecord[]
  transaction?: string
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{24,}\b/g

function scrubIdentifiers(value: string): string {
  return value
    .replace(EMAIL_RE, '[email]')
    .replace(UUID_RE, '[id]')
    .replace(/\bws_[a-z0-9]+\b/gi, '[site]')
    .replace(LONG_TOKEN_RE, '[token]')
    .replace(/\/(\d{4,})(?=\/|$)/g, '/[id]')
    .slice(0, 500)
}

function decodePathForScrubbing(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

export function sanitizeSentryUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input) return undefined
  const routed = input.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/.*)$/i)
  if (routed) {
    const path = sanitizeSentryUrl(routed[2])
    return path ? `${routed[1]!.toUpperCase()} ${path}` : undefined
  }
  if (!input.startsWith('/') && !/^(?:https?|wss?):\/\//i.test(input)) return undefined
  try {
    const url = new URL(input, 'https://perch.invalid')
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return '[redacted-url]'
    return scrubIdentifiers(decodePathForScrubbing(url.pathname))
  } catch {
    return undefined
  }
}

function scrubTraceContext(context: unknown): UnknownRecord | undefined {
  if (!context || typeof context !== 'object') return undefined
  const source = context as UnknownRecord
  const allowed = ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin']
  return Object.fromEntries(allowed.flatMap(key => source[key] === undefined ? [] : [[key, source[key]]]))
}

function scrubRequest(request: UnknownRecord | undefined): UnknownRecord | undefined {
  if (!request) return undefined
  const url = sanitizeSentryUrl(request.url)
  const method = typeof request.method === 'string' ? request.method.slice(0, 12).toUpperCase() : undefined
  if (!url && !method) return undefined
  return { ...(url ? { url } : {}), ...(method ? { method } : {}) }
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T | null): T | null {
  if (!breadcrumb || typeof breadcrumb !== 'object') return null
  const source = breadcrumb as BreadcrumbLike
  if (source.category === 'console') return null
  const data = source.data
  const safeData: UnknownRecord = {}
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      const sanitized = sanitizeSentryUrl(data[key])
      if (sanitized) safeData[key] = sanitized
    }
    if (typeof data.method === 'string') safeData.method = data.method.slice(0, 12).toUpperCase()
    if (typeof data.status_code === 'number') safeData.status_code = data.status_code
  }
  return {
    ...(source.type ? { type: source.type } : {}),
    ...(source.category ? { category: source.category } : {}),
    ...(source.level ? { level: source.level } : {}),
    ...(source.timestamp ? { timestamp: source.timestamp } : {}),
    ...(Object.keys(safeData).length ? { data: safeData } : {})
  } as T
}

function scrubSpan(span: UnknownRecord): UnknownRecord {
  const safe: UnknownRecord = {}
  for (const key of ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin', 'start_timestamp', 'timestamp']) {
    if (span[key] !== undefined) safe[key] = span[key]
  }
  if (typeof span.description === 'string') {
    safe.description = sanitizeSentryUrl(span.description) ?? '[redacted]'
  }
  return safe
}

function scrubStacktrace(stacktrace: unknown): UnknownRecord | undefined {
  if (!stacktrace || typeof stacktrace !== 'object') return undefined
  const frames = (stacktrace as UnknownRecord).frames
  if (!Array.isArray(frames)) return undefined
  return {
    frames: frames.map((frame): UnknownRecord => {
      if (!frame || typeof frame !== 'object') return {}
      const source = frame as UnknownRecord
      return {
        ...(typeof source.filename === 'string'
          ? { filename: sanitizeSentryUrl(source.filename) ?? scrubIdentifiers(source.filename) }
          : {}),
        ...(typeof source.function === 'string' ? { function: scrubIdentifiers(source.function) } : {}),
        ...(typeof source.lineno === 'number' ? { lineno: source.lineno } : {}),
        ...(typeof source.colno === 'number' ? { colno: source.colno } : {}),
        ...(typeof source.in_app === 'boolean' ? { in_app: source.in_app } : {})
      }
    })
  }
}

export function scrubSentryEvent<T>(event: T): T {
  const source = event as SentryEventLike
  const clean = { ...source } as SentryEventLike
  clean.request = scrubRequest(source.request)
  clean.breadcrumbs = (source.breadcrumbs ?? [])
    .map(breadcrumb => scrubSentryBreadcrumb(breadcrumb))
    .filter((breadcrumb): breadcrumb is BreadcrumbLike => Boolean(breadcrumb))
  clean.transaction = source.transaction ? sanitizeSentryUrl(source.transaction) ?? '[redacted]' : undefined
  clean.spans = source.spans?.map(scrubSpan)
  const trace = scrubTraceContext(source.contexts?.trace)
  clean.contexts = trace ? { trace } : undefined

  if (clean.exception?.values) {
    clean.exception = {
      ...clean.exception,
      values: clean.exception.values.map((value) => {
        const stacktrace = scrubStacktrace(value.stacktrace)
        return {
          ...(typeof value.type === 'string' ? { type: scrubIdentifiers(value.type) } : {}),
          ...(stacktrace ? { stacktrace } : {}),
          value: '[redacted]'
        }
      })
    }
  }
  clean.message = undefined

  for (const key of ['user', 'extra', 'tags', 'fingerprint', 'logentry', 'server_name']) {
    Reflect.deleteProperty(clean, key)
  }
  return clean as T
}
