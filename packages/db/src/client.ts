/**
 * Drizzle client factory. The dashboard/server creates one instance from its
 * runtime config; migrations use their own short-lived connection.
 *
 * postgres-js (not the Neon serverless driver) because the WS server is a
 * long-running single instance (§5.4) that benefits from a real connection pool.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDb>

export function createDb(connectionString: string) {
  if (!connectionString) {
    throw new Error('[@perch/db] DATABASE_URL is required to create a database client')
  }
  const sql = postgres(connectionString, {
    prepare: false,
    // keep pooled connections warm between requests — reconnecting to Neon costs
    // several TLS round trips. Neon's proxy drops idles at ~5 min; recycle just under.
    idle_timeout: 280,
    max_lifetime: 60 * 30,
    connect_timeout: 10
  })
  return drizzle(sql, { schema })
}
