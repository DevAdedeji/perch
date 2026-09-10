// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    name: 'perch/utility-boundaries',
    files: ['server/utils/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['@perch/db', 'drizzle-orm', 'postgres'],
        patterns: [{
          group: ['**/database/**', '**/domains/**', '**/integrations/**'],
          message: 'Utilities cannot own persistence or business dependencies. Put this code in its domain or infrastructure module.'
        }]
      }]
    }
  }
)
