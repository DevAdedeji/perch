/**
 * Drizzle schema — the §4 data model. Postgres, UUID primary keys, UTC timestamps.
 *
 * Column names are snake_case (Postgres convention); the inferred TS types are
 * camelCase. The string enums mirror `@perch/shared` — keep the two in lockstep.
 * Indexes follow the PRD §4 design note.
 */

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AutomationRuleConfig, BusinessHours, NotificationCategory, SavedInboxFilters, VisitorMetadata } from '@perch/shared'

/* Enums (mirror @perch/shared) */

export const roleEnum = pgEnum('role', ['admin', 'agent'])
export const presenceEnum = pgEnum('presence', ['online', 'offline', 'away'])
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'revoked'])
export const conversationStatusEnum = pgEnum('conversation_status', ['unassigned', 'open', 'resolved'])
export const conversationPriorityEnum = pgEnum('conversation_priority', ['low', 'normal', 'high', 'urgent'])
export const senderTypeEnum = pgEnum('sender_type', ['visitor', 'agent', 'system'])
export const automationRuleTypeEnum = pgEnum('automation_rule_type', [
  'round_robin', 'page_assignment', 'vip_tagging', 'inactivity_reminder', 'auto_close'
])
export const supportOutcomeEventTypeEnum = pgEnum('support_outcome_event_type', ['resolution', 'csat'])
export const reminderDeliveryStatusEnum = pgEnum('reminder_delivery_status', ['pending', 'processing', 'sent', 'failed', 'canceled'])
export const notificationCategoryEnum = pgEnum('notification_category', ['assignment', 'mention', 'unanswered_reminder'])
export const visitorEmailSourceEnum = pgEnum('visitor_email_source', ['prechat', 'unsigned_identify', 'host_asserted'])
export const visitorEmailSuppressionReasonEnum = pgEnum('visitor_email_suppression_reason', ['unsubscribe', 'bounce', 'complaint'])
export const webhookJobStatusEnum = pgEnum('webhook_job_status', [
  'pending',
  'processing',
  'retrying',
  'succeeded',
  'dead_letter',
  'canceled'
])
export const billingIntervalEnum = pgEnum('billing_interval', ['monthly', 'yearly'])
export const subscriptionStatusEnum = pgEnum('subscription_status', ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'paid', 'failed'])
export const billingWebhookStatusEnum = pgEnum('billing_webhook_status', ['processing', 'completed', 'ignored', 'failed'])
export const attachmentKindEnum = pgEnum('attachment_kind', ['message', 'logo'])
export const attachmentStateEnum = pgEnum('attachment_state', [
  'pending',
  'claimed',
  'processing',
  'retrying',
  'deleted',
  'dead_letter'
])

/* Tables */

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  // Google-only accounts can add a password later through the reset flow.
  passwordHash: text('password_hash'),
  // Google's stable `sub` claim, never the mutable email address, identifies
  // the connected Google account.
  googleId: text('google_id'),
  name: text('name').notNull(),
  // null = unverified; existing accounts are grandfathered in the migration
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('users_google_id_uq').on(t.googleId)
])

/**
 * Every Cloudinary upload Perch creates is registered before its URL is
 * accepted anywhere else. workspaceId intentionally has no foreign key: the
 * row is also the durable deletion job after a workspace has been removed.
 */
export const attachmentAssets = pgTable('attachment_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id'),
  // Snapshot identifiers deliberately survive account/workspace deletion until
  // Cloudinary confirms deletion. They contain no email, name, or session data.
  uploaderUserId: uuid('uploader_user_id'),
  visitorRef: uuid('visitor_ref'),
  kind: attachmentKindEnum('kind').notNull(),
  publicId: text('public_id').notNull().unique(),
  secureUrl: text('secure_url').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  state: attachmentStateEnum('state').default('pending').notNull(),
  cleanupReason: text('cleanup_reason'),
  cleanupAttempts: integer('cleanup_attempts').default(0).notNull(),
  cleanupNextAttemptAt: timestamp('cleanup_next_attempt_at', { withTimezone: true }),
  cleanupLockedAt: timestamp('cleanup_locked_at', { withTimezone: true }),
  cleanupLastError: text('cleanup_last_error'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  check('attachment_assets_owner_ck', sql`num_nonnulls(${t.uploaderUserId}, ${t.visitorRef}) = 1`),
  check('attachment_assets_scope_ck', sql`(${t.kind} = 'message' and ${t.workspaceId} is not null) or (${t.kind} = 'logo' and ${t.uploaderUserId} is not null and ${t.visitorRef} is null)`),
  check('attachment_assets_size_ck', sql`${t.byteSize} >= 0 and ${t.byteSize} <= 1048576`),
  check('attachment_assets_attempts_ck', sql`${t.cleanupAttempts} >= 0 and ${t.cleanupAttempts} <= 5`),
  index('attachment_assets_workspace_state_idx').on(t.workspaceId, t.state),
  index('attachment_assets_cleanup_due_idx').on(t.state, t.cleanupNextAttemptAt),
  index('attachment_assets_pending_age_idx').on(t.state, t.createdAt)
])

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  siteId: text('site_id').notNull().unique(),
  // branding shown in the visitor widget
  logoUrl: text('logo_url'),
  logoAssetId: uuid('logo_asset_id').references(() => attachmentAssets.id, { onDelete: 'set null' }),
  widgetPrimaryColor: text('widget_primary_color').default('#f59e0b').notNull(),
  widgetGreeting: text('widget_greeting').default('Hi there 👋').notNull(),
  widgetIntro: text('widget_intro').default('Tell us a bit about you and how we can help.').notNull(),
  widgetOfflineMessage: text('widget_offline_message').default('We’re away right now, but leave a message and we’ll get back to you.').notNull(),
  widgetPosition: text('widget_position', { enum: ['left', 'right'] }).default('right').notNull(),
  widgetSize: text('widget_size', { enum: ['compact', 'standard', 'large'] }).default('standard').notNull(),
  widgetTheme: text('widget_theme', { enum: ['light', 'dark', 'system'] }).default('system').notNull(),
  widgetShowBranding: boolean('widget_show_branding').default(true).notNull(),
  autoAssignEnabled: boolean('auto_assign_enabled').default(false).notNull(),
  prechatFormEnabled: boolean('prechat_form_enabled').default(true).notNull(),
  // HMAC secret the business signs Perch.identify() payloads with (lazily generated)
  identitySecret: text('identity_secret'),
  // when on, unsigned identify() calls are rejected (Intercom-style enforcement)
  identityVerificationEnabled: boolean('identity_verification_enabled').default(false).notNull(),
  // hostnames allowed to embed the widget; empty = any site (see isDomainAllowed)
  allowedDomains: text('allowed_domains').array().default([]).notNull(),
  // weekly schedule ("mon": {open,close} | null); NULL column = always available
  businessHours: jsonb('business_hours').$type<BusinessHours>(),
  // IANA timezone the schedule is evaluated in (required when hours are set)
  timezone: text('timezone'),
  unansweredReminderEnabled: boolean('unanswered_reminder_enabled').default(false).notNull(),
  unansweredReminderDelayMinutes: integer('unanswered_reminder_delay_minutes').default(15).notNull(),
  unansweredReminderBusinessHoursOnly: boolean('unanswered_reminder_business_hours_only').default(false).notNull(),
  visitorReplyEmailEnabled: boolean('visitor_reply_email_enabled').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  check('workspaces_unanswered_reminder_delay_ck', sql`${t.unansweredReminderDelayMinutes} between 5 and 1440`)
])

export const workspaceSubscriptions = pgTable('workspace_subscriptions', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: subscriptionStatusEnum('status').default('canceled').notNull(),
  interval: billingIntervalEnum('interval').default('monthly').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  bachsSubscriptionId: text('bachs_subscription_id').unique(),
  lastInvoiceReference: text('last_invoice_reference'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const workspaceInvoices = pgTable('workspace_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull().unique(),
  status: invoiceStatusEnum('status').default('pending').notNull(),
  interval: billingIntervalEnum('interval').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').default('USD').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  bachsCheckoutId: text('bachs_checkout_id'),
  checkoutUrl: text('checkout_url'),
  bachsChargeId: text('bachs_charge_id'),
  lastError: text('last_error'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  check('workspace_invoices_amount_ck', sql`${t.amountCents} > 0`),
  index('workspace_invoices_workspace_created_idx').on(t.workspaceId, t.createdAt)
])

export const billingWebhookDeliveries = pgTable('billing_webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  providerEventId: text('provider_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  status: billingWebhookStatusEnum('status').default('processing').notNull(),
  attempts: integer('attempts').default(1).notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('billing_webhook_deliveries_status_updated_idx').on(t.status, t.updatedAt)
])

export const widgetInstallationSignals = pgTable('widget_installation_signals', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pageHash: text('page_hash').notNull(),
  pageUrl: text('page_url').notNull(),
  pageOrigin: text('page_origin').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('widget_installation_signals_workspace_page_uq').on(t.workspaceId, t.pageHash),
  index('widget_installation_signals_workspace_recency_idx').on(t.workspaceId, t.lastSeenAt),
  index('widget_installation_signals_workspace_first_seen_idx').on(t.workspaceId, t.firstSeenAt)
])

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  presence: presenceEnum('presence').default('offline').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
}, t => [
  uniqueIndex('workspace_members_workspace_user_uq').on(t.workspaceId, t.userId),
  index('workspace_members_user_idx').on(t.userId)
])

export const invites = pgTable('invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: roleEnum('role').notNull(),
  token: text('token').notNull().unique(),
  status: inviteStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
})

export const visitors = pgTable('visitors', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  visitorId: text('visitor_id').notNull(),
  name: text('name'),
  email: text('email'),
  emailSource: visitorEmailSourceEnum('email_source'),
  emailUpdatedAt: timestamp('email_updated_at', { withTimezone: true }),
  replyEmailEnabled: boolean('reply_email_enabled').default(false).notNull(),
  replyEmailConsentAt: timestamp('reply_email_consent_at', { withTimezone: true }),
  // Agent-maintained overrides stay separate from visitor-supplied identity.
  // This prevents an internal edit from being presented as HMAC-verified data.
  profileName: text('profile_name'),
  profileEmail: text('profile_email'),
  company: text('company'),
  jobTitle: text('job_title'),
  internalNote: text('internal_note'),
  profileVersion: integer('profile_version').default(1).notNull(),
  // the host platform's own user id (via Perch.identify)
  externalId: text('external_id'),
  // true when the identify payload carried a valid HMAC signature
  identityVerified: boolean('identity_verified').default(false).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').$type<VisitorMetadata>().default({}).notNull()
}, t => [
  uniqueIndex('visitors_workspace_visitor_uq').on(t.workspaceId, t.visitorId)
])

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  visitorRef: uuid('visitor_ref').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  assignedAgentId: uuid('assigned_agent_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  // Teammates explicitly looped in through an internal-note mention.
  collaboratorMemberIds: uuid('collaborator_member_ids').array().default([]).notNull(),
  status: conversationStatusEnum('status').default('unassigned').notNull(),
  priority: conversationPriorityEnum('priority').default('normal').notNull(),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  isSpam: boolean('is_spam').default(false).notNull(),
  spamMarkedAt: timestamp('spam_marked_at', { withTimezone: true }),
  spamMarkedByMemberId: uuid('spam_marked_by_member_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  // CSAT: the visitor's post-resolve rating (one per conversation, overwritable)
  csatRating: text('csat_rating', { enum: ['good', 'bad'] }),
  csatComment: text('csat_comment'),
  csatAt: timestamp('csat_at', { withTimezone: true })
}, t => [
  // inbox listing + status filters, sorted by recency (§4 design note)
  index('conversations_workspace_status_recency_idx').on(t.workspaceId, t.status, t.lastMessageAt),
  index('conversations_workspace_priority_recency_idx').on(t.workspaceId, t.priority, t.lastMessageAt),
  index('conversations_workspace_snoozed_idx').on(t.workspaceId, t.snoozedUntil),
  // Defense in depth for concurrent widget and agent-initiated starts.
  uniqueIndex('conversations_visitor_active_uq')
    .on(t.visitorRef)
    .where(sql`${t.status} in ('unassigned', 'open')`),
  index('conversations_workspace_spam_recency_idx').on(t.workspaceId, t.isSpam, t.lastMessageAt),
  check(
    'conversations_spam_state_ck',
    sql`(${t.isSpam} = true and ${t.spamMarkedAt} is not null) or (${t.isSpam} = false and ${t.spamMarkedAt} is null)`
  )
])

/** Reversible workspace-local messaging blocks. The target row keeps PII out of block records. */
export const visitorBlocks = pgTable('visitor_blocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  visitorRef: uuid('visitor_ref').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  sourceConversationId: uuid('source_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  blockedByMemberId: uuid('blocked_by_member_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  blockedAt: timestamp('blocked_at', { withTimezone: true }).defaultNow().notNull(),
  unblockedByMemberId: uuid('unblocked_by_member_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  unblockedAt: timestamp('unblocked_at', { withTimezone: true })
}, t => [
  uniqueIndex('visitor_blocks_active_visitor_uq')
    .on(t.visitorRef)
    .where(sql`${t.unblockedAt} is null`),
  index('visitor_blocks_workspace_recency_idx').on(t.workspaceId, t.blockedAt),
  index('visitor_blocks_workspace_active_idx')
    .on(t.workspaceId, t.visitorRef)
    .where(sql`${t.unblockedAt} is null`),
  check(
    'visitor_blocks_unblocked_state_ck',
    sql`${t.unblockedAt} is not null or ${t.unblockedByMemberId} is null`
  )
])

/** Saved inbox filters are private to one workspace membership. */
export const inboxSavedViews = pgTable('inbox_saved_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<SavedInboxFilters>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('inbox_saved_views_member_name_uq').on(t.memberId, t.name),
  index('inbox_saved_views_member_created_idx').on(t.memberId, t.createdAt)
])

export const automationRules = pgTable('automation_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  requestKey: uuid('request_key').notNull(),
  name: text('name').notNull(),
  type: automationRuleTypeEnum('type').notNull(),
  config: jsonb('config').$type<AutomationRuleConfig>().notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('automation_rules_workspace_request_uq').on(t.workspaceId, t.requestKey),
  index('automation_rules_workspace_order_idx').on(t.workspaceId, t.sortOrder, t.createdAt)
])

export const automationRuleCursors = pgTable('automation_rule_cursors', {
  ruleId: uuid('rule_id').primaryKey().references(() => automationRules.id, { onDelete: 'cascade' }),
  nextIndex: integer('next_index').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const automationExecutions = pgTable('automation_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleId: uuid('rule_id').notNull().references(() => automationRules.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  executionKey: text('execution_key').notNull(),
  activityAt: timestamp('activity_at', { withTimezone: true }),
  memberId: uuid('member_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('automation_executions_key_uq').on(t.executionKey),
  index('automation_executions_activity_idx').on(t.ruleId, t.conversationId, t.activityAt, t.memberId),
  index('automation_executions_rule_recency_idx').on(t.ruleId, t.executedAt),
  index('automation_executions_conversation_idx').on(t.conversationId)
])

export const automationNotifications = pgTable('automation_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  executionId: uuid('execution_id').notNull().references(() => automationExecutions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true })
}, t => [
  uniqueIndex('automation_notifications_execution_uq').on(t.executionId),
  index('automation_notifications_member_unread_idx').on(t.memberId, t.readAt, t.createdAt)
])

export const supportOutcomeEvents = pgTable('support_outcome_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  eventType: supportOutcomeEventTypeEnum('event_type').notNull(),
  requestId: uuid('request_id'),
  // Snapshot ID stays intact if a member leaves; null identifies an automated outcome.
  actorMemberId: uuid('actor_member_id'),
  rating: text('rating', { enum: ['good', 'bad'] }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  check(
    'support_outcome_events_payload_ck',
    sql`(${t.eventType} = 'resolution' and ${t.requestId} is null and ${t.rating} is null) or (${t.eventType} = 'csat' and ${t.requestId} is not null and ${t.rating} in ('good', 'bad'))`
  ),
  uniqueIndex('support_outcome_events_conversation_request_uq').on(t.conversationId, t.requestId),
  index('support_outcome_events_workspace_type_time_idx').on(t.workspaceId, t.eventType, t.occurredAt),
  index('support_outcome_events_conversation_type_time_idx').on(t.conversationId, t.eventType, t.occurredAt)
])

/** Workspace-defined conversation labels ("billing", "bug", …). */
export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('tags_workspace_name_uq').on(t.workspaceId, t.name)
])

export const conversationTags = pgTable('conversation_tags', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' })
}, t => [
  uniqueIndex('conversation_tags_uq').on(t.conversationId, t.tagId),
  index('conversation_tags_tag_idx').on(t.tagId)
])

/** Reusable workspace tags attached to a customer across every conversation. */
export const visitorTags = pgTable('visitor_tags', {
  visitorId: uuid('visitor_id').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' })
}, t => [
  uniqueIndex('visitor_tags_uq').on(t.visitorId, t.tagId),
  index('visitor_tags_tag_idx').on(t.tagId)
])

/** The team lounge: one internal chat room per workspace (agents only, never visitors). */
export const teamMessages = pgTable('team_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  mentionedMemberIds: uuid('mentioned_member_ids').array().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('team_messages_workspace_recency_idx').on(t.workspaceId, t.createdAt)
])

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderType: senderTypeEnum('sender_type').notNull(),
  // null when the sender is the visitor or the system
  senderId: uuid('sender_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  attachmentUrl: text('attachment_url'),
  attachmentType: text('attachment_type'),
  attachmentAssetId: uuid('attachment_asset_id').references(() => attachmentAssets.id, { onDelete: 'set null' }),
  // true = agent-only; the visitor WS pipeline must NEVER receive these (§4)
  isInternalNote: boolean('is_internal_note').default(false).notNull(),
  // Validated workspace member ids selected through the internal-note composer.
  mentionedMemberIds: uuid('mentioned_member_ids').array().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
  index('messages_public_conversation_sender_time_idx')
    .on(t.conversationId, t.senderType, t.createdAt)
    .where(sql`${t.isInternalNote} = false`),
  index('messages_public_sender_time_conversation_idx')
    .on(t.senderType, t.createdAt, t.conversationId, t.senderId)
    .where(sql`${t.isInternalNote} = false`),
  uniqueIndex('messages_attachment_asset_uq').on(t.attachmentAssetId).where(sql`${t.attachmentAssetId} is not null`)
])

/** Last public message the visitor actually viewed in an open chat surface. */
export const visitorConversationReads = pgTable('visitor_conversation_reads', {
  conversationId: uuid('conversation_id').primaryKey().references(() => conversations.id, { onDelete: 'cascade' }),
  visitorRef: uuid('visitor_ref').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  lastMessageId: uuid('last_message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('visitor_conversation_reads_visitor_idx').on(t.visitorRef, t.readAt)
])

/** Workspace-scoped reply-email opt-outs and provider abuse suppressions. */
export const visitorEmailSuppressions = pgTable('visitor_email_suppressions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  emailHash: text('email_hash').notNull(),
  reason: visitorEmailSuppressionReasonEnum('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('visitor_email_suppressions_workspace_email_uq').on(t.workspaceId, t.emailHash),
  index('visitor_email_suppressions_workspace_created_idx').on(t.workspaceId, t.createdAt)
])

/** Durable visitor reply-email outbox, deduplicated to one email per visitor turn. */
export const visitorReplyDeliveries = pgTable('visitor_reply_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  visitorRef: uuid('visitor_ref').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  visitorMessageId: uuid('visitor_message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  agentMessageId: uuid('agent_message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  recipientEmailHash: text('recipient_email_hash').notNull(),
  status: reminderDeliveryStatusEnum('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  tokenConsumedAt: timestamp('token_consumed_at', { withTimezone: true }),
  providerMessageId: text('provider_message_id'),
  lastError: text('last_error'),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('visitor_reply_deliveries_turn_email_uq').on(t.visitorMessageId, t.recipientEmailHash),
  uniqueIndex('visitor_reply_deliveries_agent_message_uq').on(t.agentMessageId),
  index('visitor_reply_deliveries_due_idx').on(t.status, t.nextAttemptAt),
  index('visitor_reply_deliveries_conversation_idx').on(t.conversationId, t.createdAt),
  index('visitor_reply_deliveries_recipient_idx').on(t.recipientEmailHash, t.createdAt),
  check('visitor_reply_deliveries_attempts_ck', sql`${t.attempts} between 0 and 5`)
])

/** Durable email outbox: one reminder per unanswered visitor message and recipient. */
export const unansweredReminderDeliveries = pgTable('unanswered_reminder_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  visitorMessageId: uuid('visitor_message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  recipientMemberId: uuid('recipient_member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  status: reminderDeliveryStatusEnum('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('unanswered_reminder_message_recipient_uq').on(t.visitorMessageId, t.recipientMemberId),
  index('unanswered_reminder_due_idx').on(t.status, t.nextAttemptAt),
  index('unanswered_reminder_workspace_idx').on(t.workspaceId, t.createdAt)
])

/** Durable in-app delivery for assignments and @mentions. */
export const memberNotifications = pgTable('member_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  recipientMemberId: uuid('recipient_member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  actorMemberId: uuid('actor_member_id').references(() => workspaceMembers.id, { onDelete: 'set null' }),
  actorName: text('actor_name').notNull(),
  type: text('type', { enum: ['mention', 'assignment'] }).notNull(),
  source: text('source', { enum: ['nest', 'conversation'] }).notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  teamMessageId: uuid('team_message_id').references(() => teamMessages.id, { onDelete: 'cascade' }),
  excerpt: text('excerpt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true })
}, t => [
  check(
    'member_notifications_target_ck',
    sql`(${t.type} = 'assignment' and ${t.source} = 'conversation' and ${t.conversationId} is not null and ${t.messageId} is null and ${t.teamMessageId} is null)
      or (${t.type} = 'mention' and ${t.source} = 'conversation' and ${t.conversationId} is not null and ${t.messageId} is not null and ${t.teamMessageId} is null)
      or (${t.type} = 'mention' and ${t.source} = 'nest' and ${t.conversationId} is null and ${t.messageId} is null and ${t.teamMessageId} is not null)`
  ),
  uniqueIndex('member_notifications_message_recipient_uq')
    .on(t.messageId, t.recipientMemberId)
    .where(sql`${t.messageId} is not null`),
  uniqueIndex('member_notifications_team_message_recipient_uq')
    .on(t.teamMessageId, t.recipientMemberId)
    .where(sql`${t.teamMessageId} is not null`),
  index('member_notifications_recipient_unread_idx').on(t.recipientMemberId, t.readAt, t.createdAt),
  index('member_notifications_workspace_recency_idx').on(t.workspaceId, t.createdAt)
])

/** Personal delivery choices for one member in one workspace. */
export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  category: notificationCategoryEnum('category').$type<NotificationCategory>().notNull(),
  inAppEnabled: boolean('in_app_enabled').default(true).notNull(),
  browserEnabled: boolean('browser_enabled').default(false).notNull(),
  emailEnabled: boolean('email_enabled').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('notification_preferences_member_category_uq').on(t.memberId, t.category),
  index('notification_preferences_member_idx').on(t.memberId)
])

/** Per-agent read tracking; unread is derived (last_message_at > last_read_at). */
export const conversationReads = pgTable('conversation_reads', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => workspaceMembers.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('conversation_reads_conversation_member_uq').on(t.conversationId, t.memberId)
])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // sha256 of the emailed token — the raw token is never stored
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // the address being verified — the user's own on signup, or the pending NEW
  // address for an email change (applied when the token is redeemed)
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

/**
 * Server-side session registry. The sealed cookie alone can't be revoked, so
 * every sign-in also creates a row here and `requireUser` checks the row still
 * exists — deleting it signs that device out (within the cache window).
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('sessions_user_recency_idx').on(t.userId, t.lastSeenAt)
])

/**
 * Workspace audit trail: who did what, when. Rows survive actor deletion
 * (actor_id nulls out; actor_name is a snapshot) but vanish with the
 * workspace — a deleted workspace has nobody left to read its log.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('audit_logs_workspace_recency_idx').on(t.workspaceId, t.createdAt)
])

/** Help-center article groups ("Getting started", "Billing", …). */
export const articleGroups = pgTable('article_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('article_groups_workspace_order_idx').on(t.workspaceId, t.sortOrder)
])

/**
 * Help-center articles. Body is plain text (rendered as paragraphs) — visitors
 * read these inside the widget iframe on OUR origin, so no workspace-authored
 * HTML/markdown until it can be sanitized properly.
 */
export const articles = pgTable('articles', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull().references(() => articleGroups.id, { onDelete: 'cascade' }),
  // denormalized so widget/dashboard queries never need the join for scoping
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  // external FAQ link — when set, the widget opens this instead of the body
  url: text('url'),
  status: text('status', { enum: ['draft', 'published'] }).default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('articles_workspace_status_created_idx').on(t.workspaceId, t.status, t.createdAt)
])

export const cannedResponses = pgTable('canned_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  shortcut: text('shortcut').notNull(),
  content: text('content').notNull()
}, t => [
  uniqueIndex('canned_responses_workspace_shortcut_uq').on(t.workspaceId, t.shortcut)
])

/**
 * Proactive trigger rules ("on /pricing for 30s → open the widget with a
 * message"). Evaluated server-side against the live visitor presence registry.
 */
export const triggers = pgTable('triggers', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // case-insensitive substring matched against the visitor's page URL; '' = every page
  urlMatch: text('url_match').default('').notNull(),
  dwellSeconds: integer('dwell_seconds').notNull(),
  message: text('message').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('triggers_workspace_idx').on(t.workspaceId)
])

/**
 * One row per (trigger, visitor) fire — the unique index IS the
 * "fires at most once per visitor per rule" guarantee (§6.4-style atomic guard).
 */
export const triggerFires = pgTable('trigger_fires', {
  triggerId: uuid('trigger_id').notNull().references(() => triggers.id, { onDelete: 'cascade' }),
  visitorRef: uuid('visitor_ref').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('trigger_fires_uq').on(t.triggerId, t.visitorRef),
  index('trigger_fires_visitor_idx').on(t.visitorRef)
])

/**
 * Outbound webhook endpoints: HMAC-signed POSTs on conversation/message events.
 * The secret is shown in full once at creation, masked afterwards.
 */
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  // subscribed event names ('conversation.created', 'message.created', …)
  events: text('events').array().default([]).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('webhook_endpoints_workspace_idx').on(t.workspaceId)
])

/** Immutable domain events waiting to fan out to the endpoints subscribed at commit time. */
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('webhook_events_workspace_dedupe_uq').on(t.workspaceId, t.dedupeKey),
  index('webhook_events_workspace_created_idx').on(t.workspaceId, t.createdAt),
  check('webhook_events_name_ck', sql`${t.event} in ('conversation.created', 'message.created', 'conversation.resolved')`)
])

/** One durable job per endpoint/event pair. Endpoint secrets are never copied here. */
export const webhookJobs = pgTable('webhook_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').notNull().references(() => webhookEvents.id, { onDelete: 'cascade' }),
  status: webhookJobStatusEnum('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  lastHttpStatus: integer('last_http_status'),
  lastDurationMs: integer('last_duration_ms'),
  lastError: text('last_error'),
  cancelReason: text('cancel_reason'),
  replayCount: integer('replay_count').default(0).notNull(),
  lastReplayKey: uuid('last_replay_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  uniqueIndex('webhook_jobs_endpoint_event_uq').on(t.endpointId, t.eventId),
  index('webhook_jobs_due_idx').on(t.status, t.nextAttemptAt),
  index('webhook_jobs_endpoint_created_idx').on(t.endpointId, t.createdAt),
  index('webhook_jobs_workspace_status_idx').on(t.workspaceId, t.status, t.updatedAt),
  check('webhook_jobs_attempts_ck', sql`${t.attempts} between 0 and 6`),
  check('webhook_jobs_replay_count_ck', sql`${t.replayCount} >= 0`)
])

/** Individual HTTP attempts, linked to a durable job when one exists. */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => webhookJobs.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  ok: boolean('ok').notNull(),
  httpStatus: integer('http_status'),
  durationMs: integer('duration_ms').notNull(),
  attempt: integer('attempt').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('webhook_deliveries_endpoint_recency_idx').on(t.endpointId, t.createdAt),
  index('webhook_deliveries_job_attempt_idx').on(t.jobId, t.attempt)
])

/* Inferred row types */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type WidgetInstallationSignal = typeof widgetInstallationSignals.$inferSelect
export type NewWidgetInstallationSignal = typeof widgetInstallationSignals.$inferInsert
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert
export type Invite = typeof invites.$inferSelect
export type NewInvite = typeof invites.$inferInsert
export type Visitor = typeof visitors.$inferSelect
export type NewVisitor = typeof visitors.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type VisitorBlock = typeof visitorBlocks.$inferSelect
export type NewVisitorBlock = typeof visitorBlocks.$inferInsert
export type InboxSavedView = typeof inboxSavedViews.$inferSelect
export type NewInboxSavedView = typeof inboxSavedViews.$inferInsert
export type AutomationRule = typeof automationRules.$inferSelect
export type NewAutomationRule = typeof automationRules.$inferInsert
export type AutomationExecution = typeof automationExecutions.$inferSelect
export type AutomationNotification = typeof automationNotifications.$inferSelect
export type SupportOutcomeEvent = typeof supportOutcomeEvents.$inferSelect
export type NewSupportOutcomeEvent = typeof supportOutcomeEvents.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type MemberNotification = typeof memberNotifications.$inferSelect
export type NewMemberNotification = typeof memberNotifications.$inferInsert
export type NotificationPreference = typeof notificationPreferences.$inferSelect
export type ConversationRead = typeof conversationReads.$inferSelect
export type NewConversationRead = typeof conversationReads.$inferInsert
export type VisitorConversationRead = typeof visitorConversationReads.$inferSelect
export type VisitorReplyDelivery = typeof visitorReplyDeliveries.$inferSelect
export type CannedResponse = typeof cannedResponses.$inferSelect
export type NewCannedResponse = typeof cannedResponses.$inferInsert
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert
export type Trigger = typeof triggers.$inferSelect
export type NewTrigger = typeof triggers.$inferInsert
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert
export type WebhookEvent = typeof webhookEvents.$inferSelect
export type WebhookJob = typeof webhookJobs.$inferSelect
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert
export type WorkspaceSubscription = typeof workspaceSubscriptions.$inferSelect
export type WorkspaceInvoice = typeof workspaceInvoices.$inferSelect
export type BillingWebhookDelivery = typeof billingWebhookDeliveries.$inferSelect
export type UnansweredReminderDelivery = typeof unansweredReminderDeliveries.$inferSelect
