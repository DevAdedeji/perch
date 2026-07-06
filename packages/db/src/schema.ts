/**
 * Drizzle schema — the §4 data model. Postgres, UUID primary keys, UTC timestamps.
 *
 * Column names are snake_case (Postgres convention); the inferred TS types are
 * camelCase. The string enums mirror `@perch/shared` — keep the two in lockstep.
 * Indexes follow the PRD §4 design note.
 */

import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'
import type { VisitorMetadata } from '@perch/shared'

/* ── Enums (mirror @perch/shared) ───────────────────────────────── */

export const roleEnum = pgEnum('role', ['admin', 'agent'])
export const presenceEnum = pgEnum('presence', ['online', 'offline', 'away'])
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'revoked'])
export const conversationStatusEnum = pgEnum('conversation_status', ['unassigned', 'open', 'resolved'])
export const senderTypeEnum = pgEnum('sender_type', ['visitor', 'agent', 'system'])

/* ── Tables ─────────────────────────────────────────────────────── */

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  siteId: text('site_id').notNull().unique(),
  // branding shown in the visitor widget
  logoUrl: text('logo_url'),
  widgetPrimaryColor: text('widget_primary_color').default('#f59e0b').notNull(),
  autoAssignEnabled: boolean('auto_assign_enabled').default(false).notNull(),
  prechatFormEnabled: boolean('prechat_form_enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  presence: presenceEnum('presence').default('offline').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
}, t => [
  uniqueIndex('workspace_members_workspace_user_uq').on(t.workspaceId, t.userId)
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
  status: conversationStatusEnum('status').default('unassigned').notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
}, t => [
  // inbox listing + status filters, sorted by recency (§4 design note)
  index('conversations_workspace_status_recency_idx').on(t.workspaceId, t.status, t.lastMessageAt)
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
  // true = agent-only; the visitor WS pipeline must NEVER receive these (§4)
  isInternalNote: boolean('is_internal_note').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, t => [
  index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)
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

export const cannedResponses = pgTable('canned_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  shortcut: text('shortcut').notNull(),
  content: text('content').notNull()
}, t => [
  uniqueIndex('canned_responses_workspace_shortcut_uq').on(t.workspaceId, t.shortcut)
])

/* ── Inferred row types ─────────────────────────────────────────── */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert
export type Invite = typeof invites.$inferSelect
export type NewInvite = typeof invites.$inferInsert
export type Visitor = typeof visitors.$inferSelect
export type NewVisitor = typeof visitors.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type ConversationRead = typeof conversationReads.$inferSelect
export type NewConversationRead = typeof conversationReads.$inferInsert
export type CannedResponse = typeof cannedResponses.$inferSelect
export type NewCannedResponse = typeof cannedResponses.$inferInsert
