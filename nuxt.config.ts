// https://nuxt.com/docs/api/configuration/nuxt-config
// Perch dashboard — Nuxt app + Nitro API + (soon) WS handler
import { normalizeLaunchOrigin } from './config/launch'

const publicSiteUrl = normalizeLaunchOrigin(
  process.env.PERCH_PUBLIC_URL,
  process.env.NODE_ENV !== 'production'
) ?? ''

const staticDocumentHeaders = {
  'x-frame-options': 'DENY',
  'content-security-policy': 'base-uri \'self\'; object-src \'none\'; form-action \'self\'; frame-ancestors \'none\'',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-permitted-cross-domain-policies': 'none',
  'origin-agent-cluster': '?1',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
}

if (process.env.npm_lifecycle_event === 'build' && !publicSiteUrl) {
  throw new Error('PERCH_PUBLIC_URL is required while building so prerendered pages use the public origin.')
}

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/motion/nuxt',
    'nuxt-auth-utils',
    '@sentry/nuxt/module'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  ui: {
    // Remote font-provider discovery makes otherwise identical builds depend
    // on third-party metadata endpoints. Keep the committed CSS fallbacks.
    fonts: false
  },

  runtimeConfig: {
    session: {
      name: 'nuxt-session',
      sessionHeader: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      }
    },
    // server-only: Neon/Postgres connection string (read from .env)
    databaseUrl: '',
    // HMAC secret for short-lived WebSocket auth tickets (reuse the session secret)
    realtimeSecret: '',
    // transactional email (password reset, invites) — optional; logs in dev without it
    resendApiKey: '',
    emailFrom: '',
    // workspace subscriptions via Bachs
    bachsSecretKey: '',
    bachsWebhookSecret: '',
    // signed image uploads (attachments) — optional; endpoint 503s without them
    cloudinaryCloudName: '',
    cloudinaryApiKey: '',
    cloudinaryApiSecret: '',
    // comma-separated emails allowed to view instance metrics at /admin
    adminEmails: '',
    publicBaseUrl: '',
    public: {
      // Available while prerendering so production HTML never points
      // canonical and social metadata at localhost.
      siteUrl: publicSiteUrl,
      // the workspace the landing page's live demo widget talks to (site_ids are public by design)
      demoSiteId: process.env.NUXT_PUBLIC_DEMO_SITE_ID || 'ws_18c6715c14'
    }
  },

  routeRules: {
    '/': {
      prerender: true,
      headers: staticDocumentHeaders
    },
    '/privacy': { prerender: true, headers: staticDocumentHeaders },
    '/terms': { prerender: true, headers: staticDocumentHeaders },
    '/pricing': { prerender: true, headers: staticDocumentHeaders },
    '/widget.js': {
      headers: {
        'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'cross-origin-resource-policy': 'cross-origin',
        'x-permitted-cross-domain-policies': 'none',
        'strict-transport-security': 'max-age=31536000; includeSubDomains'
      }
    }
  },

  // sourcemaps are the main memory hog in the production build — off keeps the
  // Nitro bundle within a small (free-tier) builder's RAM
  sourcemap: {
    server: false,
    client: false
  },

  devServer: {
    port: 2222
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    experimental: {
      websocket: true
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  sentry: {
    // import the server config at the top of the Nitro entry — works inside
    // the Docker CMD without NODE_OPTIONS gymnastics
    autoInjectServerSentry: 'top-level-import',
    // sourcemap upload needs sourcemaps, which we keep off to stay inside the
    // free-tier builder's RAM (see `sourcemap` below)
    sourceMapsUploadOptions: {
      enabled: false
    }
  }
})
