import type { IncomingMessage } from 'node:http'

const RAW_BODY_SYMBOL = Symbol.for('h3RawBody')

async function assertApiBodySize(event: import('h3').H3Event) {
  const declaredLength = getHeader(event, 'content-length')
  const transferEncoding = getHeader(event, 'transfer-encoding')

  if (declaredLength) {
    if (transferEncoding) throw createError({ statusCode: 400, statusMessage: 'Ambiguous request body' })
    const size = Number(declaredLength)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid content length' })
    }
    if (size > MAX_API_REQUEST_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Request body is too large' })
    }
    return
  }

  if (!transferEncoding) return
  const request = event.node.req as IncomingMessage & Record<symbol, Promise<Buffer> | undefined>
  const existing = request[RAW_BODY_SYMBOL]
  const body = existing ?? new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let exceeded = false
    request.on('data', (chunk: Buffer | Uint8Array | string) => {
      if (exceeded) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_API_REQUEST_BYTES) {
        exceeded = true
        chunks.length = 0
        reject(createError({ statusCode: 413, statusMessage: 'Request body is too large' }))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (!exceeded) resolve(Buffer.concat(chunks))
    })
    request.on('error', reject)
  })
  request[RAW_BODY_SYMBOL] = body
  await body
}

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  if (!path.startsWith('/api/')) return

  setResponseHeader(event, 'Cache-Control', 'no-store')

  const method = getMethod(event)
  if (!isApiMutation(path, method)) return

  if (requiresTrustedMutationOrigin(path, method)) {
    const configuredOrigin = useRuntimeConfig(event).publicBaseUrl || process.env.PERCH_PUBLIC_URL
    const applicationOrigin = configuredOrigin
      || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
    if (!isTrustedMutationOrigin(getHeader(event, 'origin'), applicationOrigin)) {
      throw createError({ statusCode: 403, statusMessage: 'Request origin is not allowed' })
    }
  }

  await assertApiBodySize(event)

  const contentLength = getHeader(event, 'content-length')
  const transferEncoding = getHeader(event, 'transfer-encoding')
  if (hasRequestBody(contentLength, transferEncoding)
    && !acceptsApiContentType(path, getHeader(event, 'content-type'))) {
    throw createError({ statusCode: 415, statusMessage: 'Unsupported request content type' })
  }
})
