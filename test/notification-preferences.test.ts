import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultNotificationPreference, defaultNotificationPreferences } from '../packages/shared/src/notifications'
import { mergeNotificationPreferences } from '../server/utils/notification-preferences'
import { notificationPreferenceUpdateSchema } from '../server/utils/notification-preference-validation'
import {
  drainPendingReminders,
  isCurrentPreferenceGeneration,
  nextPreferenceGeneration,
  notificationAlertsReady,
  notificationPreferenceScope,
  queuePendingReminder,
  replacedPreferenceEntry
} from '../app/composables/usePersonalNotificationPreferences'

describe('personal notification preferences', () => {
  it('keeps operational in-app alerts on while browser delivery is opt-in', () => {
    expect(defaultNotificationPreferences()).toEqual([
      { category: 'assignment', in_app_enabled: true, browser_enabled: false, email_enabled: false },
      { category: 'mention', in_app_enabled: true, browser_enabled: false, email_enabled: false },
      { category: 'unanswered_reminder', in_app_enabled: true, browser_enabled: false, email_enabled: true }
    ])
  })

  it('uses saved values only for the current membership rows', () => {
    const now = new Date('2026-09-02T00:00:00Z')
    const merged = mergeNotificationPreferences([{
      id: '00000000-0000-4000-8000-000000000001',
      memberId: '00000000-0000-4000-8000-000000000002',
      category: 'mention',
      inAppEnabled: false,
      browserEnabled: true,
      emailEnabled: false,
      createdAt: now,
      updatedAt: now
    }])
    expect(merged.find(row => row.category === 'mention')).toEqual({
      category: 'mention',
      in_app_enabled: false,
      browser_enabled: true,
      email_enabled: false
    })
    expect(merged.find(row => row.category === 'unanswered_reminder'))
      .toEqual(defaultNotificationPreference('unanswered_reminder'))
  })

  it('accepts only one complete row per category and limits email to reminders', () => {
    const valid = defaultNotificationPreferences()
    expect(notificationPreferenceUpdateSchema.safeParse({ preferences: valid }).success).toBe(true)
    expect(notificationPreferenceUpdateSchema.safeParse({
      preferences: valid.map(row => row.category === 'mention' ? { ...row, email_enabled: true } : row)
    }).success).toBe(false)
    expect(notificationPreferenceUpdateSchema.safeParse({
      preferences: [valid[0], valid[0], valid[2]]
    }).success).toBe(false)
  })

  it('scopes reads and writes to the authenticated workspace membership', () => {
    const getSource = readFileSync(new URL('../server/api/workspaces/[id]/notification-preferences.get.ts', import.meta.url), 'utf8')
    const patchSource = readFileSync(new URL('../server/api/workspaces/[id]/notification-preferences.patch.ts', import.meta.url), 'utf8')
    expect(getSource).toContain('requireMembership(event, workspaceId)')
    expect(getSource).toContain('memberNotificationPreferences(member.id)')
    expect(patchSource).toContain('requireMembership(event, workspaceId)')
    expect(patchSource).toContain('memberId: member.id')
    expect(patchSource).not.toContain('member_id')
  })

  it('keeps slow workspace responses from replacing the active workspace state', () => {
    expect(notificationPreferenceScope('user-a', 'workspace-a')).not.toBe(
      notificationPreferenceScope('user-a', 'workspace-b')
    )
    const entry = {
      preferences: defaultNotificationPreferences(),
      ready: false,
      loading: true,
      generation: 2
    }
    expect(isCurrentPreferenceGeneration(entry, 1)).toBe(false)
    expect(isCurrentPreferenceGeneration(entry, 2)).toBe(true)
    expect(nextPreferenceGeneration(entry)).toBe(3)
  })

  it('publishes saved preferences into the shared live state immediately', () => {
    const preferences = defaultNotificationPreferences().map(row => row.category === 'mention'
      ? { ...row, in_app_enabled: false }
      : row)
    const entry = replacedPreferenceEntry(undefined, preferences)
    expect(entry.ready).toBe(true)
    expect(entry.preferences.find(row => row.category === 'mention')?.in_app_enabled).toBe(false)
  })

  it('fails closed while saved opt-outs are still loading', () => {
    expect(notificationAlertsReady(undefined)).toBe(false)
    expect(notificationAlertsReady({
      preferences: defaultNotificationPreferences(),
      ready: false,
      loading: true,
      generation: 1
    })).toBe(false)
  })

  it('deduplicates ephemeral reminders until preferences are ready', () => {
    const pending = new Set<string>()
    queuePendingReminder(pending, 'conversation-a')
    queuePendingReminder(pending, 'conversation-a')
    queuePendingReminder(pending, 'conversation-b')
    expect(drainPendingReminders(pending)).toEqual(['conversation-a', 'conversation-b'])
    expect(pending.size).toBe(0)
  })

  it('requests browser permission only through the user-triggered preference control', () => {
    const composable = readFileSync(new URL('../app/composables/useBrowserNotifications.ts', import.meta.url), 'utf8')
    const settings = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
    expect(composable.match(/Notification\.requestPermission\(\)/g)).toHaveLength(1)
    expect(settings).toContain('@update:model-value="setBrowserPreference')
    expect(settings).not.toContain('onMounted(requestPermission)')
  })

  it('keeps migration 0028 linear after durable webhook delivery with safe backfill defaults', () => {
    const journal = JSON.parse(readFileSync(new URL('../packages/db/migrations/meta/_journal.json', import.meta.url), 'utf8'))
    const previous = JSON.parse(readFileSync(new URL('../packages/db/migrations/meta/0027_snapshot.json', import.meta.url), 'utf8'))
    const current = JSON.parse(readFileSync(new URL('../packages/db/migrations/meta/0028_snapshot.json', import.meta.url), 'utf8'))
    const sql = readFileSync(new URL('../packages/db/migrations/0028_notification-preferences.sql', import.meta.url), 'utf8')
    expect(journal.entries.find((entry: { tag: string }) => entry.tag === '0028_notification-preferences'))
      .toMatchObject({ idx: 28, tag: '0028_notification-preferences' })
    expect(current.prevId).toBe(previous.id)
    expect(sql).toContain(`('assignment', false)`)
    expect(sql).toContain(`('mention', false)`)
    expect(sql).toContain(`('unanswered_reminder', true)`)
  })

  it('rechecks reminder responsibility and latest-message state before realtime delivery', () => {
    const source = readFileSync(new URL('../server/utils/unanswered-reminders.ts', import.meta.url), 'utf8')
    const guard = source.indexOf('if (!await reminderDeliveryIsActionable(delivery, now)) continue')
    const publish = source.indexOf('publishFiltered(channels.workspace(delivery.workspaceId)', guard)
    expect(guard).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(guard)
    expect(source).toContain('row.assignedAgentId !== delivery.recipientMemberId')
    expect(source).toContain('gt(messages.createdAt, row.messageAt)')
  })
})
