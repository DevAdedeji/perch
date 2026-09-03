import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('attachment cleanup operator surface', () => {
  const page = source('../app/pages/admin/metrics.vue')
  const sidebar = source('../app/components/DashboardSidebar.vue')
  const authRoute = source('../server/api/auth/me.get.ts')
  const platformAdmin = source('../server/utils/platform-admin.ts')
  const queueRoute = source('../server/api/admin/attachment-cleanup.get.ts')
  const retryRoute = source('../server/api/admin/attachment-cleanup/[id]/retry.post.ts')

  it('keeps queue inspection and recovery behind the platform-admin boundary', () => {
    expect(queueRoute).toContain('requirePlatformAdmin(event)')
    expect(retryRoute).toContain('requirePlatformAdmin(event)')
    expect(retryRoute).toContain(`assertRateLimit('admin-attachment-retry:ip'`)
    expect(retryRoute).toContain(`assertRateLimit('admin-attachment-retry:user'`)
    expect(retryRoute.indexOf('requirePlatformAdmin(event)'))
      .toBeLessThan(retryRoute.indexOf(`assertRateLimit('admin-attachment-retry:ip'`))
    expect(retryRoute).toContain('retryFailedAttachmentCleanup(assetId)')
    expect(platformAdmin).toContain('where: eq(users.id, user.id)')
    expect(platformAdmin).toContain('isPlatformAdminEmail(event, dbUser.email)')
  })

  it('makes the operator page discoverable only to allowlisted users', () => {
    expect(authRoute).toContain('platformAdmin: isPlatformAdminEmail(event, email)')
    expect(sidebar).toContain('platformAdmin.value')
    expect(sidebar).toContain(`to: '/admin/metrics'`)
  })

  it('does not expose attachment locations or owner identifiers to the operator UI', () => {
    expect(queueRoute).not.toContain('publicId:')
    expect(queueRoute).not.toContain('secureUrl:')
    expect(queueRoute).not.toContain('workspaceId:')
    expect(queueRoute).not.toContain('uploaderUserId:')
    expect(queueRoute).not.toContain('visitorRef:')
  })

  it('shows summary, loading, empty, error, and actionable queue states', () => {
    expect(page).toContain('metrics.attachment_cleanup.outstanding')
    expect(page).toContain('metrics.attachment_cleanup.failed')
    expect(page).toContain('cleanupLoading')
    expect(page).toContain('cleanupError')
    expect(page).toContain('No attachment cleanup jobs need operator attention.')
    expect(page).toContain('Needs manual retry')
  })

  it('only offers retry for exhausted jobs and refreshes state after the mutation', () => {
    expect(page).toContain('v-if="row.state === \'dead_letter\'"')
    expect(page).toContain('/api/admin/attachment-cleanup/${row.id}/retry')
    expect(page).toContain(`method: 'POST'`)
    expect(page).toContain('if (row.state !== \'dead_letter\' || retryingCleanupId.value) return')
    expect(page).toContain('await loadAttachmentCleanup()')
    expect(page).toContain('Cleanup was queued, but the summary could not refresh')
  })
})
