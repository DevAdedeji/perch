import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { deletionReceipt, logDeletionReceipt } from '../server/utils/deletion-receipts'

describe('data deletion recovery receipts', () => {
  it('records only recovery identifiers in a deterministic shape', () => {
    expect(deletionReceipt({
      kind: 'account',
      subjectId: 'user-1',
      cascadeWorkspaceIds: ['workspace-b', 'workspace-a', 'workspace-b'],
      occurredAt: new Date('2026-09-02T00:00:00.000Z')
    })).toEqual({
      event: 'data_deletion.completed',
      version: 1,
      kind: 'account',
      subject_id: 'user-1',
      cascade_workspace_ids: ['workspace-a', 'workspace-b'],
      occurred_at: '2026-09-02T00:00:00.000Z'
    })
  })

  it('emits one structured line after deletion succeeds', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logDeletionReceipt({ kind: 'workspace', subjectId: 'workspace-1' })
    expect(info).toHaveBeenCalledOnce()
    expect(info.mock.calls[0]?.[0]).toBe('[data-deletion-receipt]')
    expect(JSON.parse(String(info.mock.calls[0]?.[1]))).toMatchObject({
      event: 'data_deletion.completed',
      kind: 'workspace',
      subject_id: 'workspace-1'
    })
    info.mockRestore()
  })

  it('logs only after the destructive database action returns', () => {
    const workspaceDelete = readFileSync(new URL('../server/api/workspaces/[id]/index.delete.ts', import.meta.url), 'utf8')
    const accountDelete = readFileSync(new URL('../server/api/auth/account.delete.ts', import.meta.url), 'utf8')
    expect(workspaceDelete.indexOf('logDeletionReceipt')).toBeGreaterThan(workspaceDelete.indexOf('delete(workspaces)'))
    expect(accountDelete.indexOf('logDeletionReceipt')).toBeGreaterThan(accountDelete.indexOf('await db.transaction'))
    expect(workspaceDelete).not.toContain('email')
  })
})
