import {
  and,
  billingDeletionReceipts,
  count,
  eq,
  inArray,
  isNull,
  sessions,
  sql,
  users,
  workspaceInvoices,
  workspaceMembers,
  workspaces,
  workspaceSubscriptions
} from '@perch/db'
import type { Database } from '@perch/db'
import type { BachsSubscription } from './bachs'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DeletionKind = 'workspace' | 'account'

interface LocalBillingRequirement {
  workspaceId: string
  subscriptionId: string | null
}

export interface BillingDeletionConfirmation extends LocalBillingRequirement {
  providerStatus: BachsSubscription['status'] | 'not_applicable'
  cancelAtPeriodEnd: boolean | null
  providerConfirmedAt: Date | null
}

interface ProviderDependencies {
  getSubscription: (subscriptionId: string) => Promise<BachsSubscription>
  cancelSubscription: (subscriptionId: string, idempotencyKey: string) => Promise<BachsSubscription>
}

function conflict(statusMessage: string): never {
  throw createError({ statusCode: 409, statusMessage })
}

function subscriptionCannotRenew(subscription: BachsSubscription): boolean {
  return subscription.status === 'canceled' || subscription.cancel_at_period_end === true
}

function assertMatchingSubscription(subscription: BachsSubscription, expectedId: string) {
  if (subscription.id !== expectedId) {
    throw createError({ statusCode: 502, statusMessage: 'Bachs returned a different subscription.' })
  }
}

/**
 * Get provider-fresh proof that the subscription cannot renew. The DELETE is
 * naturally repeatable and also carries a stable provider idempotency key, so
 * an application retry cannot schedule more than one cancellation.
 */
export async function confirmSubscriptionWillNotRenew(
  requirement: LocalBillingRequirement,
  dependencies: ProviderDependencies = {
    getSubscription: getBachsSubscription,
    cancelSubscription: (subscriptionId, idempotencyKey) => cancelBachsSubscription(subscriptionId, idempotencyKey)
  }
): Promise<BillingDeletionConfirmation> {
  if (!requirement.subscriptionId) {
    return {
      ...requirement,
      providerStatus: 'not_applicable',
      cancelAtPeriodEnd: null,
      providerConfirmedAt: null
    }
  }

  const current = await dependencies.getSubscription(requirement.subscriptionId)
  assertMatchingSubscription(current, requirement.subscriptionId)
  const confirmed = subscriptionCannotRenew(current)
    ? current
    : await dependencies.cancelSubscription(
        requirement.subscriptionId,
        `perch-delete-${requirement.workspaceId}-${requirement.subscriptionId}`
      )
  assertMatchingSubscription(confirmed, requirement.subscriptionId)
  if (!subscriptionCannotRenew(confirmed)) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bachs did not confirm that renewal was canceled. Nothing was deleted.'
    })
  }
  return {
    ...requirement,
    providerStatus: confirmed.status,
    cancelAtPeriodEnd: confirmed.cancel_at_period_end === true,
    providerConfirmedAt: new Date()
  }
}

async function localBillingRequirement(tx: Transaction, workspaceId: string): Promise<LocalBillingRequirement> {
  const pendingInvoice = await tx.query.workspaceInvoices.findFirst({
    where: and(
      eq(workspaceInvoices.workspaceId, workspaceId),
      eq(workspaceInvoices.status, 'pending')
    ),
    columns: { id: true }
  })
  if (pendingInvoice) {
    conflict('This workspace has an unfinished checkout. Finish it or let it expire, then try deletion again.')
  }

  const [subscription, anyPaidInvoice] = await Promise.all([
    tx.query.workspaceSubscriptions.findFirst({
      where: eq(workspaceSubscriptions.workspaceId, workspaceId)
    }),
    tx.query.workspaceInvoices.findFirst({
      where: and(
        eq(workspaceInvoices.workspaceId, workspaceId),
        eq(workspaceInvoices.status, 'paid')
      ),
      columns: { id: true }
    })
  ])
  if (!subscription) {
    if (anyPaidInvoice) {
      conflict('Perch cannot confirm the billing-provider subscription. Nothing was deleted; contact support or try again after billing syncs.')
    }
    return { workspaceId, subscriptionId: null }
  }
  if (subscription.bachsSubscriptionId) {
    return { workspaceId, subscriptionId: subscription.bachsSubscriptionId }
  }

  if (anyPaidInvoice || subscription.status !== 'canceled') {
    conflict('Perch cannot confirm the billing-provider subscription. Nothing was deleted; contact support or try again after billing syncs.')
  }
  return { workspaceId, subscriptionId: null }
}

async function lockWorkspace(tx: Transaction, workspaceId: string) {
  const rows = await tx.select().from(workspaces)
    .where(eq(workspaces.id, workspaceId)).limit(1).for('update')
  return rows[0]
}

async function assertAdmin(tx: Transaction, workspaceId: string, userId: string) {
  const member = await tx.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId)
    )
  })
  if (!member) throw createError({ statusCode: 403, statusMessage: 'You are not a member of this workspace' })
  if (member.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
}

export async function prepareWorkspaceDeletion(input: {
  workspaceId: string
  userId: string
  confirmation: string
}): Promise<LocalBillingRequirement> {
  return useDb().transaction(async (tx) => {
    const workspace = await lockWorkspace(tx, input.workspaceId)
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
    await assertAdmin(tx, input.workspaceId, input.userId)
    if (input.confirmation !== workspace.name) {
      throw createError({ statusCode: 400, statusMessage: 'Type the exact workspace name to confirm deletion.' })
    }
    const requirement = await localBillingRequirement(tx, input.workspaceId)
    if (!workspace.deletionRequestedAt) {
      await tx.update(workspaces).set({ deletionRequestedAt: sql`now()` })
        .where(eq(workspaces.id, input.workspaceId))
    }
    return requirement
  })
}

async function persistReceipt(
  tx: Transaction,
  confirmation: BillingDeletionConfirmation,
  deletionKind: DeletionKind,
  deleted: boolean
) {
  await tx.insert(billingDeletionReceipts).values({
    workspaceId: confirmation.workspaceId,
    deletionKind,
    bachsSubscriptionId: confirmation.subscriptionId,
    providerStatus: confirmation.providerStatus,
    cancelAtPeriodEnd: confirmation.cancelAtPeriodEnd,
    providerConfirmedAt: confirmation.providerConfirmedAt,
    deletedAt: deleted ? sql`now()` : null
  }).onConflictDoUpdate({
    target: billingDeletionReceipts.workspaceId,
    set: {
      deletionKind,
      bachsSubscriptionId: confirmation.subscriptionId,
      providerStatus: confirmation.providerStatus,
      cancelAtPeriodEnd: confirmation.cancelAtPeriodEnd,
      providerConfirmedAt: confirmation.providerConfirmedAt,
      deletedAt: deleted ? sql`now()` : billingDeletionReceipts.deletedAt
    },
    // A completed receipt is immutable audit evidence. In particular, a
    // slower duplicate request must not clear or rewrite it after deletion.
    setWhere: isNull(billingDeletionReceipts.deletedAt)
  })
}

export async function recordBillingDeletionConfirmation(
  confirmation: BillingDeletionConfirmation,
  deletionKind: DeletionKind
) {
  await useDb().transaction(tx => persistReceipt(tx, confirmation, deletionKind, false))
}

async function assertConfirmationStillCurrent(tx: Transaction, confirmation: BillingDeletionConfirmation) {
  const current = await localBillingRequirement(tx, confirmation.workspaceId)
  if (current.subscriptionId !== confirmation.subscriptionId) {
    conflict('Billing changed while deletion was running. Nothing was deleted; please try again.')
  }
  if (confirmation.subscriptionId && confirmation.providerStatus === 'not_applicable') {
    conflict('Provider cancellation has not been confirmed. Nothing was deleted; please try again.')
  }
}

export async function finalizeWorkspaceDeletion(input: {
  workspaceId: string
  userId: string
  confirmationText: string
  billing: BillingDeletionConfirmation
}) {
  await useDb().transaction(async (tx) => {
    const workspace = await lockWorkspace(tx, input.workspaceId)
    if (!workspace) return
    await assertAdmin(tx, input.workspaceId, input.userId)
    if (input.confirmationText !== workspace.name) {
      throw createError({ statusCode: 400, statusMessage: 'The workspace name changed. Type its current name and try again.' })
    }
    await assertConfirmationStillCurrent(tx, input.billing)
    await persistReceipt(tx, input.billing, 'workspace', true)
    await tx.delete(workspaces).where(eq(workspaces.id, input.workspaceId))
  })
}

interface AccountPreparation {
  requirements: LocalBillingRequirement[]
  workspaceIds: string[]
}

async function accountWorkspacePlan(tx: Transaction, userId: string) {
  const memberships = await tx.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, userId)
  })
  const workspaceIds = memberships.map(row => row.workspaceId).sort()
  for (const workspaceId of workspaceIds) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`)
    await lockWorkspace(tx, workspaceId)
  }

  const soloWorkspaceIds: string[] = []
  for (const membership of memberships) {
    const [total] = await tx.select({ n: count() }).from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, membership.workspaceId))
    if (Number(total?.n) === 1) {
      soloWorkspaceIds.push(membership.workspaceId)
      continue
    }
    if (membership.role === 'admin') {
      const [admins] = await tx.select({ n: count() }).from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, membership.workspaceId),
        eq(workspaceMembers.role, 'admin')
      ))
      if (Number(admins?.n) === 1) {
        const workspace = await tx.query.workspaces.findFirst({ where: eq(workspaces.id, membership.workspaceId) })
        conflict(`You're the only admin of "${workspace?.name ?? 'a workspace'}" — promote a teammate or delete that workspace first`)
      }
    }
  }
  return { memberships, workspaceIds, soloWorkspaceIds: soloWorkspaceIds.sort() }
}

export async function prepareAccountDeletion(userId: string): Promise<AccountPreparation> {
  return useDb().transaction(async (tx) => {
    const plan = await accountWorkspacePlan(tx, userId)
    const requirements: LocalBillingRequirement[] = []
    for (const workspaceId of plan.soloWorkspaceIds) {
      requirements.push(await localBillingRequirement(tx, workspaceId))
    }
    if (plan.soloWorkspaceIds.length) {
      await tx.update(workspaces).set({ deletionRequestedAt: sql`now()` })
        .where(inArray(workspaces.id, plan.soloWorkspaceIds))
    }
    return { requirements, workspaceIds: plan.workspaceIds }
  })
}

export async function finalizeAccountDeletion(input: {
  userId: string
  preparedWorkspaceIds: string[]
  billingConfirmations: BillingDeletionConfirmation[]
}) {
  return useDb().transaction(async (tx) => {
    // Serialize with workspace creation and invite acceptance. Their membership
    // inserts take a foreign-key key-share lock on this user, so neither can
    // appear after the membership plan below and leave an orphaned workspace.
    const userRows = await tx.select({ id: users.id }).from(users)
      .where(eq(users.id, input.userId)).limit(1).for('update')
    if (!userRows[0]) return { revokedSessionIds: [], soloWorkspaceIds: [] }

    const plan = await accountWorkspacePlan(tx, input.userId)
    const prepared = new Set(input.preparedWorkspaceIds)
    if (plan.workspaceIds.some(id => !prepared.has(id))) {
      conflict('Your workspace memberships changed while deletion was running. Nothing was deleted; please try again.')
    }

    const byWorkspace = new Map(input.billingConfirmations.map(item => [item.workspaceId, item]))
    for (const workspaceId of plan.soloWorkspaceIds) {
      const confirmation = byWorkspace.get(workspaceId)
      if (!confirmation) conflict('A workspace still needs billing cancellation confirmation. Nothing was deleted; please try again.')
      await assertConfirmationStillCurrent(tx, confirmation)
      await persistReceipt(tx, confirmation, 'account', true)
    }

    const activeSessions = await tx.query.sessions.findMany({
      where: eq(sessions.userId, input.userId), columns: { id: true }
    })
    if (plan.soloWorkspaceIds.length) {
      await tx.delete(workspaces).where(inArray(workspaces.id, plan.soloWorkspaceIds))
    }
    await tx.delete(users).where(eq(users.id, input.userId))
    return {
      revokedSessionIds: activeSessions.map(row => row.id),
      soloWorkspaceIds: plan.soloWorkspaceIds
    }
  })
}
