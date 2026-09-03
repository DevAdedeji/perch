import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from '../packages/db/node_modules/postgres/src/index.js'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('billing migration chain', () => {
  const client = postgres(databaseUrl!, { max: 1 })
  const schemaName = `billing_migration_${randomUUID().replaceAll('-', '')}`

  function migrationSql(name: string) {
    return readFileSync(new URL(`../packages/db/migrations/${name}`, import.meta.url), 'utf8')
      .replaceAll('"public"', `"${schemaName}"`)
      .replaceAll(`'public.`, `'${schemaName}.`)
  }

  async function applyMigration(name: string) {
    const statements = migrationSql(name)
      .split('--> statement-breakpoint')
      .map(statement => statement.trim())
      .filter(Boolean)
    for (const statement of statements) await client.unsafe(statement)
  }

  beforeAll(async () => {
    await client.unsafe(`create schema "${schemaName}"`)
    await client.unsafe(`set search_path to "${schemaName}", public`)
  })

  afterAll(async () => {
    await client.unsafe(`drop schema if exists "${schemaName}" cascade`)
    await client.end()
  })

  it('applies the fresh chain without reopening a paid invoice superseded by the current subscription lineage', async () => {
    const migrations = readdirSync(new URL('../packages/db/migrations', import.meta.url))
      .filter(name => /^\d{4}.*\.sql$/.test(name))
      .sort()
    const reconciliationMigration = '0029_fair_hiroim.sql'
    const reconciliationIndex = migrations.indexOf(reconciliationMigration)
    expect(reconciliationIndex).toBeGreaterThan(0)
    for (const name of migrations.slice(0, reconciliationIndex)) await applyMigration(name)

    const workspaceId = randomUUID()
    const historicalInvoiceId = randomUUID()
    const currentInvoiceId = randomUUID()
    const legacyNoProviderInvoiceId = randomUUID()
    const legacyProviderInvoiceId = randomUUID()
    await client.unsafe(`
      insert into "${schemaName}"."workspaces" (id, name, site_id)
      values ('${workspaceId}', 'Migration fixture', 'fixture-${workspaceId.slice(0, 8)}')
    `)
    await client.unsafe(`
      insert into "${schemaName}"."workspace_invoices"
        (id, workspace_id, reference, status, interval, amount_cents, currency, period_start, period_end,
         bachs_checkout_id, paid_at, created_at, updated_at)
      values
        ('${historicalInvoiceId}', '${workspaceId}', 'paid-lineage-a', 'paid', 'monthly', 900, 'USD',
         '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', 'checkout-a', '2026-06-01T00:00:00Z',
         '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
        ('${currentInvoiceId}', '${workspaceId}', 'current-lineage-b', 'paid', 'monthly', 900, 'USD',
         '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'checkout-b', '2026-08-01T00:00:00Z',
         '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
        ('${legacyNoProviderInvoiceId}', '${workspaceId}', 'legacy-no-provider', 'pending', 'yearly', 9000, 'USD',
         '2026-08-15T00:00:00Z', '2027-08-15T00:00:00Z', NULL, NULL,
         '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z'),
        ('${legacyProviderInvoiceId}', '${workspaceId}', 'legacy-provider-backed', 'pending', 'yearly', 9000, 'USD',
         '2026-08-16T00:00:00Z', '2027-08-16T00:00:00Z', 'checkout-legacy', NULL,
         '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')
    `)
    await client.unsafe(`
      insert into "${schemaName}"."workspace_subscriptions"
        (workspace_id, status, interval, current_period_end, bachs_subscription_id, last_invoice_reference)
      values ('${workspaceId}', 'active', 'monthly', '2026-09-01T00:00:00Z', 'subscription-b', 'current-lineage-b')
    `)

    await applyMigration(reconciliationMigration)

    const rows = await client.unsafe<Array<{ reference: string, checkout_closed_at: Date | null, bachs_product_id: string | null }>>(`
      select reference, checkout_closed_at, bachs_product_id
      from "${schemaName}"."workspace_invoices"
      where workspace_id = '${workspaceId}'
      order by created_at
    `)
    expect(rows).toHaveLength(4)
    expect(rows.find(row => row.reference === 'paid-lineage-a')?.checkout_closed_at).toBeInstanceOf(Date)
    expect(rows.find(row => row.reference === 'current-lineage-b')?.checkout_closed_at).toBeInstanceOf(Date)
    expect(rows.find(row => row.reference === 'legacy-no-provider')?.checkout_closed_at).toBeInstanceOf(Date)
    expect(rows.find(row => row.reference === 'legacy-provider-backed')?.checkout_closed_at).toBeNull()
    expect(rows.find(row => row.reference === 'legacy-provider-backed')?.bachs_product_id).toBeNull()

    const jobs = await client.unsafe<Array<{ workspace_id: string, status: string }>>(`
      select workspace_id, status
      from "${schemaName}"."billing_reconciliation_jobs"
      where workspace_id = '${workspaceId}'
    `)
    expect(jobs).toEqual([{ workspace_id: workspaceId, status: 'pending' }])

    for (const name of migrations.slice(reconciliationIndex + 1)) await applyMigration(name)
  }, 60_000)
})
