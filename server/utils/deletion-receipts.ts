export interface DeletionReceiptInput {
  kind: 'account' | 'workspace'
  subjectId: string
  cascadeWorkspaceIds?: string[]
  occurredAt?: Date
}

export function deletionReceipt(input: DeletionReceiptInput) {
  return {
    event: 'data_deletion.completed',
    version: 1,
    kind: input.kind,
    subject_id: input.subjectId,
    cascade_workspace_ids: [...new Set(input.cascadeWorkspaceIds ?? [])].sort(),
    occurred_at: (input.occurredAt ?? new Date()).toISOString()
  }
}

export function logDeletionReceipt(input: DeletionReceiptInput): void {
  console.info('[data-deletion-receipt]', JSON.stringify(deletionReceipt(input)))
}
