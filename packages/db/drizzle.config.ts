import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs with cwd = packages/db; the connection string lives in the repo-root .env
config({ path: '../../.env' })

const url = process.env.NEON_CONNECTION_STRING ?? process.env.DATABASE_URL
if (!url) {
  throw new Error('[@perch/db] NEON_CONNECTION_STRING is not set in the repo-root .env')
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  strict: true,
  verbose: true
})
