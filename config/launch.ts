const MIN_SECRET_LENGTH = 32

export interface LaunchEnvironment {
  [key: string]: string | undefined
  NODE_ENV?: string
  NEON_CONNECTION_STRING?: string
  NUXT_SESSION_PASSWORD?: string
  REALTIME_SECRET?: string
  PERCH_PUBLIC_URL?: string
  NUXT_OAUTH_GOOGLE_CLIENT_ID?: string
  NUXT_OAUTH_GOOGLE_CLIENT_SECRET?: string
  NUXT_OAUTH_GOOGLE_REDIRECT_URL?: string
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  BACHS_ENV?: string
  BACHS_SECRET_KEY?: string
  BACHS_WEBHOOK_SECRET?: string
  CLOUDINARY_CLOUD_NAME?: string
  CLOUDINARY_API_KEY?: string
  CLOUDINARY_API_SECRET?: string
  PERCH_WEBHOOK_ALLOW_LOCALHOST?: string
}

function value(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

export function normalizeLaunchOrigin(input: unknown, allowHttp = false): string | null {
  const raw = value(input)
  if (!raw) return null

  try {
    const url = new URL(raw)
    const validProtocol = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
    if (!validProtocol || url.username || url.password) return null
    if (url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

function isStrongSecret(input: unknown): boolean {
  const secret = value(input)
  if (secret.length < MIN_SECRET_LENGTH) return false
  if (/replace|example|change.?me|your[_-]?secret/i.test(secret)) return false
  return new Set(secret).size >= 8
}

function isPostgresUrl(input: unknown): boolean {
  try {
    const url = new URL(value(input))
    return (url.protocol === 'postgres:' || url.protocol === 'postgresql:')
      && Boolean(url.hostname && url.pathname !== '/')
  } catch {
    return false
  }
}

function requireCompleteGroup(
  errors: string[],
  environment: LaunchEnvironment,
  names: Array<keyof LaunchEnvironment>
) {
  const configured = names.filter(name => value(environment[name]))
  if (configured.length > 0 && configured.length !== names.length) {
    errors.push(`${names.join(', ')} must be configured together`)
  }
}

export function productionConfigErrors(environment: LaunchEnvironment): string[] {
  const errors: string[] = []

  if (!isPostgresUrl(environment.NEON_CONNECTION_STRING)) {
    errors.push('NEON_CONNECTION_STRING must be a PostgreSQL connection URL')
  }
  if (!isStrongSecret(environment.NUXT_SESSION_PASSWORD)) {
    errors.push('NUXT_SESSION_PASSWORD must be a non-placeholder secret of at least 32 characters')
  }
  if (value(environment.REALTIME_SECRET) && !isStrongSecret(environment.REALTIME_SECRET)) {
    errors.push('REALTIME_SECRET must be a non-placeholder secret of at least 32 characters')
  }
  if (!normalizeLaunchOrigin(environment.PERCH_PUBLIC_URL)) {
    errors.push('PERCH_PUBLIC_URL must be an HTTPS origin without a path, query, or credentials')
  }

  requireCompleteGroup(errors, environment, [
    'NUXT_OAUTH_GOOGLE_CLIENT_ID',
    'NUXT_OAUTH_GOOGLE_CLIENT_SECRET',
    'NUXT_OAUTH_GOOGLE_REDIRECT_URL'
  ])
  if (value(environment.NUXT_OAUTH_GOOGLE_REDIRECT_URL)) {
    try {
      const redirect = new URL(value(environment.NUXT_OAUTH_GOOGLE_REDIRECT_URL))
      if (redirect.protocol !== 'https:' || redirect.username || redirect.password) {
        errors.push('NUXT_OAUTH_GOOGLE_REDIRECT_URL must be an HTTPS URL without credentials')
      }
    } catch {
      errors.push('NUXT_OAUTH_GOOGLE_REDIRECT_URL must be a valid URL')
    }
  }

  if (!value(environment.RESEND_API_KEY) || !value(environment.RESEND_FROM)) {
    errors.push('RESEND_API_KEY and RESEND_FROM are required for production account recovery')
  }
  requireCompleteGroup(errors, environment, ['BACHS_ENV', 'BACHS_SECRET_KEY', 'BACHS_WEBHOOK_SECRET'])
  const bachsEnvironment = value(environment.BACHS_ENV)
  if (bachsEnvironment && bachsEnvironment !== 'sandbox' && bachsEnvironment !== 'live') {
    errors.push('BACHS_ENV must be sandbox or live')
  }
  if (bachsEnvironment && value(environment.BACHS_SECRET_KEY)) {
    const sandboxKey = value(environment.BACHS_SECRET_KEY).startsWith('sk_sandbox_')
    if ((bachsEnvironment === 'sandbox') !== sandboxKey) {
      errors.push('BACHS_ENV must match the Bachs secret-key environment')
    }
  }
  requireCompleteGroup(errors, environment, [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
  ])
  if (value(environment.PERCH_WEBHOOK_ALLOW_LOCALHOST).toLowerCase() === 'true') {
    errors.push('PERCH_WEBHOOK_ALLOW_LOCALHOST must not be enabled in production')
  }

  return errors
}

export function assertProductionConfig(environment: LaunchEnvironment): void {
  const errors = productionConfigErrors(environment)
  if (errors.length) {
    throw new Error(`Invalid production configuration:\n- ${errors.join('\n- ')}`)
  }
}
