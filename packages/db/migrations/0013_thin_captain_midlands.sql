-- Older deployments may already contain duplicate active threads from racing
-- first messages. Keep the newest active thread and close the rest before the
-- invariant is installed.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY visitor_ref
    ORDER BY last_message_at DESC, created_at DESC, id DESC
  ) AS position
  FROM conversations
  WHERE status IN ('unassigned', 'open')
)
UPDATE conversations AS conversation
SET status = 'resolved',
    resolved_at = COALESCE(conversation.resolved_at, now()),
    updated_at = now()
FROM ranked
WHERE conversation.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX "conversations_visitor_active_uq" ON "conversations" USING btree ("visitor_ref") WHERE "conversations"."status" in ('unassigned', 'open');
