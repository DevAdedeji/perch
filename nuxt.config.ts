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
    realtimeSecret: process.env.NUXT_SESSION_PASSWORD
  },

  routeRules: {
    '/': { prerender: true }
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
