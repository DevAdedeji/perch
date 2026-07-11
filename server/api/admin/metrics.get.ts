import { conversations, messages, sql, users, workspaces } from '@perch/db'

/**
 * Instance-level product metrics for the operator (gated by PERCH_ADMIN_EMAILS).
 * "Is the business alive?" in one payload: totals, 7-day activity, and a
 * 14-day signups/messages series.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const allowed = (useRuntimeConfig(event).adminEmails ?? '')
    .split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean)
  if (!allowed.includes(user.email.toLowerCase())) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' }) // don't advertise the panel
  }

  const db = useDb()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [totals, active, series] = await Promise.all([
    db.execute(sql`
      select
        (select count(*) from ${users}) as users,
        (select count(*) from ${workspaces}) as workspaces,
        (select count(*) from ${conversations}) as conversations,
        (select count(*) from ${messages} where is_internal_note = false) as messages
    `),
    db.execute(sql`
      select
        (select count(*) from ${users} where created_at > ${weekAgo.toISOString()}::timestamptz) as new_users_7d,
        (select count(distinct workspace_id) from ${conversations}
          where last_message_at > ${weekAgo.toISOString()}::timestamptz) as active_workspaces_7d,
        (select count(*) from ${conversations} where created_at > ${weekAgo.toISOString()}::timestamptz) as new_conversations_7d,
        (select count(*) from ${messages}
          where created_at > ${weekAgo.toISOString()}::timestamptz and is_internal_note = false) as messages_7d
    `),
    db.execute(sql`
      with days as (select generate_series(current_date - 13, current_date, '1 day')::date as day)
      select
        days.day::text,
        (select count(*) from ${users} u where u.created_at::date = days.day) as signups,
        (select count(*) from ${messages} m
          where m.created_at::date = days.day and m.is_internal_note = false) as messages
      from days order by days.day
    `)
  ])

  // postgres-js returns the row array directly
  return {
    totals: totals[0],
    last_7d: active[0],
    daily: [...series]
  }
})
