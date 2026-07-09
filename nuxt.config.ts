// https://nuxt.com/docs/api/configuration/nuxt-config
// Perch dashboard — Nuxt app + Nitro API + (soon) WS handler
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/motion/nuxt',
    'nuxt-auth-utils'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // server-only: Neon/Postgres connection string (read from .env)
    databaseUrl: process.env.NEON_CONNECTION_STRING,
    // HMAC secret for short-lived WebSocket auth tickets (reuse the session secret)
    realtimeSecret: process.env.NUXT_SESSION_PASSWORD,
    public: {
      // the workspace the landing page's live demo widget talks to (site_ids are public by design)
      demoSiteId: process.env.NUXT_PUBLIC_DEMO_SITE_ID || 'ws_18c6715c14'
    }
  },

  routeRules: {
    '/': { prerender: true }
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
  }
})
