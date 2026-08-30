import { conversations, eq, messages, sql, users, workspaceMembers, workspaces } from '@perch/db'
import {
  resolveSupportAnalyticsWindow,
  toFiniteNumber,
  toNullableFiniteNumber
} from '../../../utils/support-analytics'

interface SummaryRow extends Record<string, unknown> {
  conversations: unknown
  resolved: unknown
  unanswered: unknown
  missed: unknown
  average_first_response_seconds: unknown
  average_resolution_seconds: unknown
  csat_good: unknown
  csat_bad: unknown
}

interface TrendRow extends Record<string, unknown> {
  day: string
  conversations: unknown
  visitor_messages: unknown
  resolved: unknown
}

interface HourRow extends Record<string, unknown> {
  hour: unknown
  visitor_messages: unknown
  conversations: unknown
}

interface MemberRow extends Record<string, unknown> {
  id: string
  name: string
  role: 'admin' | 'agent'
  open_conversations: unknown
  handled_conversations: unknown
  replies: unknown
  resolved_conversations: unknown
  average_first_response_seconds: unknown
  csat_good: unknown
  csat_bad: unknown
}

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId)

  const range = resolveSupportAnalyticsWindow(getQuery(event).range ?? '30d')
  if (!range) {
    throw createError({ statusCode: 400, statusMessage: 'Range must be 7d, 30d, or 90d' })
  }

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({
    columns: { timezone: true },
    where: eq(workspaces.id, workspaceId)
  })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const timezone = workspace.timezone ?? 'UTC'
  const start = range.start.toISOString()
  const end = range.end.toISOString()

  const [summaryRows, trendRows, hourRows, memberRows] = await Promise.all([
    db.execute<SummaryRow>(sql`
      with relevant_conversations as (
        select
          c.*,
          first_visitor.created_at as first_visitor_at,
          first_agent.created_at as first_agent_at
        from ${conversations} c
        left join lateral (
          select m.created_at
          from ${messages} m
          where m.conversation_id = c.id
            and m.sender_type = 'visitor'
            and m.is_internal_note = false
          order by m.created_at asc
          limit 1
        ) first_visitor on true
        left join lateral (
          select m.created_at
          from ${messages} m
          where m.conversation_id = c.id
            and m.sender_type = 'agent'
            and m.is_internal_note = false
            and m.created_at >= first_visitor.created_at
          order by m.created_at asc
          limit 1
        ) first_agent on true
        where c.workspace_id = ${workspaceId}::uuid
          and (
            (c.created_at >= ${start}::timestamptz and c.created_at < ${end}::timestamptz)
            or (c.resolved_at >= ${start}::timestamptz and c.resolved_at < ${end}::timestamptz)
            or (c.csat_at >= ${start}::timestamptz and c.csat_at < ${end}::timestamptz)
          )
      )
      select
        count(*) filter (
          where created_at >= ${start}::timestamptz and created_at < ${end}::timestamptz
        ) as conversations,
        count(*) filter (
          where resolved_at >= ${start}::timestamptz and resolved_at < ${end}::timestamptz
        ) as resolved,
        count(*) filter (
          where created_at >= ${start}::timestamptz
            and created_at < ${end}::timestamptz
            and first_visitor_at is not null
            and first_agent_at is null
        ) as unanswered,
        count(*) filter (
          where created_at >= ${start}::timestamptz
            and created_at < ${end}::timestamptz
            and status <> 'resolved'
            and first_visitor_at is not null
            and first_agent_at is null
            and last_message_at <= ${end}::timestamptz - interval '15 minutes'
        ) as missed,
        avg(extract(epoch from (first_agent_at - first_visitor_at)))
          filter (
            where created_at >= ${start}::timestamptz
              and created_at < ${end}::timestamptz
              and first_agent_at is not null
          ) as average_first_response_seconds,
        avg(extract(epoch from (resolved_at - created_at)))
          filter (
            where resolved_at >= ${start}::timestamptz
              and resolved_at < ${end}::timestamptz
              and resolved_at >= created_at
          ) as average_resolution_seconds,
        count(*) filter (
          where csat_rating = 'good'
            and csat_at >= ${start}::timestamptz
            and csat_at < ${end}::timestamptz
        ) as csat_good,
        count(*) filter (
          where csat_rating = 'bad'
            and csat_at >= ${start}::timestamptz
            and csat_at < ${end}::timestamptz
        ) as csat_bad
      from relevant_conversations
    `),
    db.execute<TrendRow>(sql`
      with days as (
        select generate_series(
          (${start}::timestamptz at time zone ${timezone})::date,
          (${end}::timestamptz at time zone ${timezone})::date,
          interval '1 day'
        )::date as day
      ),
      daily_conversations as (
        select (c.created_at at time zone ${timezone})::date as day, count(*) as total
        from ${conversations} c
        where c.workspace_id = ${workspaceId}::uuid
          and c.created_at >= ${start}::timestamptz
          and c.created_at < ${end}::timestamptz
        group by 1
      ),
      daily_messages as (
        select (m.created_at at time zone ${timezone})::date as day, count(*) as total
        from ${messages} m
        inner join ${conversations} c on c.id = m.conversation_id
        where c.workspace_id = ${workspaceId}::uuid
          and m.sender_type = 'visitor'
          and m.is_internal_note = false
          and m.created_at >= ${start}::timestamptz
          and m.created_at < ${end}::timestamptz
        group by 1
      ),
      daily_resolutions as (
        select (c.resolved_at at time zone ${timezone})::date as day, count(*) as total
        from ${conversations} c
        where c.workspace_id = ${workspaceId}::uuid
          and c.resolved_at >= ${start}::timestamptz
          and c.resolved_at < ${end}::timestamptz
        group by 1
      )
      select
        days.day::text as day,
        coalesce(daily_conversations.total, 0) as conversations,
        coalesce(daily_messages.total, 0) as visitor_messages,
        coalesce(daily_resolutions.total, 0) as resolved
      from days
      left join daily_conversations on daily_conversations.day = days.day
      left join daily_messages on daily_messages.day = days.day
      left join daily_resolutions on daily_resolutions.day = days.day
      order by days.day
    `),
    db.execute<HourRow>(sql`
      select
        extract(hour from m.created_at at time zone ${timezone})::integer as hour,
        count(*) as visitor_messages,
        count(distinct m.conversation_id) as conversations
      from ${messages} m
      inner join ${conversations} c on c.id = m.conversation_id
      where c.workspace_id = ${workspaceId}::uuid
        and m.sender_type = 'visitor'
        and m.is_internal_note = false
        and m.created_at >= ${start}::timestamptz
        and m.created_at < ${end}::timestamptz
      group by 1
      order by visitor_messages desc, hour asc
      limit 6
    `),
    db.execute<MemberRow>(sql`
      with first_visitors as (
        select m.conversation_id, min(m.created_at) as created_at
        from ${messages} m
        inner join ${conversations} c on c.id = m.conversation_id
        where c.workspace_id = ${workspaceId}::uuid
          and c.created_at >= ${start}::timestamptz
          and c.created_at < ${end}::timestamptz
          and m.sender_type = 'visitor'
          and m.is_internal_note = false
        group by m.conversation_id
      ),
      first_agents as (
        select distinct on (m.conversation_id)
          m.conversation_id,
          m.sender_id,
          m.created_at
        from ${messages} m
        inner join first_visitors fv on fv.conversation_id = m.conversation_id
        where m.sender_type = 'agent'
          and m.is_internal_note = false
          and m.created_at >= fv.created_at
        order by m.conversation_id, m.created_at asc
      )
      select
        wm.id,
        u.name,
        wm.role,
        (
          select count(*)
          from ${conversations} c
          where c.assigned_agent_id = wm.id and c.status = 'open'
        ) as open_conversations,
        (
          select count(distinct m.conversation_id)
          from ${messages} m
          inner join ${conversations} c on c.id = m.conversation_id
          where m.sender_id = wm.id
            and c.workspace_id = ${workspaceId}::uuid
            and m.sender_type = 'agent'
            and m.is_internal_note = false
            and m.created_at >= ${start}::timestamptz
            and m.created_at < ${end}::timestamptz
        ) as handled_conversations,
        (
          select count(*)
          from ${messages} m
          inner join ${conversations} c on c.id = m.conversation_id
          where m.sender_id = wm.id
            and c.workspace_id = ${workspaceId}::uuid
            and m.sender_type = 'agent'
            and m.is_internal_note = false
            and m.created_at >= ${start}::timestamptz
            and m.created_at < ${end}::timestamptz
        ) as replies,
        (
          select count(*)
          from ${conversations} c
          where c.assigned_agent_id = wm.id
            and c.resolved_at >= ${start}::timestamptz
            and c.resolved_at < ${end}::timestamptz
        ) as resolved_conversations,
        (
          select avg(extract(epoch from (fa.created_at - fv.created_at)))
          from first_agents fa
          inner join first_visitors fv on fv.conversation_id = fa.conversation_id
          where fa.sender_id = wm.id
        ) as average_first_response_seconds,
        (
          select count(*)
          from ${conversations} c
          where c.assigned_agent_id = wm.id
            and c.csat_rating = 'good'
            and c.csat_at >= ${start}::timestamptz
            and c.csat_at < ${end}::timestamptz
        ) as csat_good,
        (
          select count(*)
          from ${conversations} c
          where c.assigned_agent_id = wm.id
            and c.csat_rating = 'bad'
            and c.csat_at >= ${start}::timestamptz
            and c.csat_at < ${end}::timestamptz
        ) as csat_bad
      from ${workspaceMembers} wm
      inner join ${users} u on u.id = wm.user_id
      where wm.workspace_id = ${workspaceId}::uuid
      order by handled_conversations desc, u.name asc
    `)
  ])

  const rawSummary = summaryRows[0]
  const good = toFiniteNumber(rawSummary?.csat_good)
  const bad = toFiniteNumber(rawSummary?.csat_bad)
  const rated = good + bad

  return {
    range: {
      key: range.key,
      days: range.days,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      timezone
    },
    summary: {
      conversations: toFiniteNumber(rawSummary?.conversations),
      resolved: toFiniteNumber(rawSummary?.resolved),
      unanswered: toFiniteNumber(rawSummary?.unanswered),
      missed: toFiniteNumber(rawSummary?.missed),
      averageFirstResponseSeconds: toNullableFiniteNumber(rawSummary?.average_first_response_seconds),
      averageResolutionSeconds: toNullableFiniteNumber(rawSummary?.average_resolution_seconds),
      csat: {
        good,
        bad,
        rated,
        positivePercent: rated > 0 ? Math.round((good / rated) * 100) : null
      }
    },
    trend: [...trendRows].map(row => ({
      day: row.day,
      conversations: toFiniteNumber(row.conversations),
      visitorMessages: toFiniteNumber(row.visitor_messages),
      resolved: toFiniteNumber(row.resolved)
    })),
    busiestHours: [...hourRows].map(row => ({
      hour: toFiniteNumber(row.hour),
      visitorMessages: toFiniteNumber(row.visitor_messages),
      conversations: toFiniteNumber(row.conversations)
    })),
    team: [...memberRows].map((row) => {
      const memberGood = toFiniteNumber(row.csat_good)
      const memberBad = toFiniteNumber(row.csat_bad)
      const memberRated = memberGood + memberBad
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        openConversations: toFiniteNumber(row.open_conversations),
        handledConversations: toFiniteNumber(row.handled_conversations),
        replies: toFiniteNumber(row.replies),
        resolvedConversations: toFiniteNumber(row.resolved_conversations),
        averageFirstResponseSeconds: toNullableFiniteNumber(row.average_first_response_seconds),
        csat: {
          good: memberGood,
          bad: memberBad,
          rated: memberRated,
          positivePercent: memberRated > 0 ? Math.round((memberGood / memberRated) * 100) : null
        }
      }
    })
  }
})
