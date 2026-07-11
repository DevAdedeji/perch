# Perch 🐦

**A live-chat support platform, built from scratch — real WebSockets, multi-tenant, embeddable.**

Perch is a hosted live-chat product in the vein of Intercom, Crisp, and Tawk.to. A business signs up,
creates a workspace, and drops a single `<script>` tag on their site. Visitors chat from a floating
widget; support agents answer from a real-time **Control Room** dashboard — with presence, typing
indicators, unread state, and race-safe conversation claiming.

> Built as a portfolio + learning project to demonstrate end-to-end engineering: real-time systems,
> presence, multi-tenancy with auth scoping, secure third-party embedding, and concurrency correctness.
> Every dependency is free or on a genuine free tier.

**Live:** https://perch.adedeji.xyz &nbsp;·&nbsp; **Stack:** Nuxt 4 · Nitro WebSockets · Drizzle · Neon Postgres

<!-- Drop screenshots here for the portfolio view:
![Control Room inbox](docs/control-room.png)
![Embedded widget](docs/widget.png)
-->

---

## What it does

**For the business (the Control Room)**
- Email/password auth with sealed-cookie sessions; a user can belong to multiple workspaces.
- Real-time inbox — new conversations and messages appear instantly, filterable by `unassigned` / `open` / `resolved`.
- **Claim / assign / reassign** conversations, with an atomic first-claim-wins race guard.
- Per-agent unread tracking, internal notes (never leaked to the visitor), resolve/reopen.
- Live team presence (online / away / offline) and role-scoped visibility (agents see unassigned + their own; admins see everything).
- Settings: workspace name, copyable embed snippet, pre-chat toggle, and team management (invite / remove / change role).
- In-dashboard toast + notification sound on new messages.

**For the visitor (the widget)**
- One `<script>` tag, no build step, isolated in an iframe so it can't collide with the host site.
- Anonymous identity via a `localStorage` `visitor_id` — closing/refreshing resumes the same conversation.
- Live thread, agent typing indicator, and a "business online/offline" status.
- Optional pre-chat form (name / email), toggleable per workspace.
- **`Perch.identify()`** — sites with signed-in users pass `{ user_id, name, email }` so pre-chat is
  skipped and agents see who they're talking to, with optional **HMAC identity verification** so
  visitors can't impersonate each other (see below).

### Identify your users

```html
<script>
  // if your user is signed in when the page renders (safe in any script order —
  // the loader picks this up when it initializes):
  window.perchIdentity = {
    user_id: 'user_42',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    hash: '<hmac from your server>' // required if verification is enforced
  }

  // or, for logins that happen after page load (SPA):
  Perch.identify({ user_id, name, email, hash })
</script>
```

With **identity verification** enabled (Settings → Identity verification), Perch rejects any
identify call whose `hash` isn't a valid HMAC-SHA256 of the `user_id` (or email), keyed with the
workspace's secret — computed on the business's server, never in the browser:

```js
// Node.js — on YOUR server
import { createHmac } from 'node:crypto'
const hash = createHmac('sha256', PERCH_IDENTITY_SECRET).update(user.id).digest('hex')
```

Verified visitors get a green **Verified** badge in the agent's context panel.

---

## What this project demonstrates

- **Real-time architecture with a typed event contract.** The client→server and server→client event
  shapes live in a shared package (`@perch/shared`) imported by the dashboard, the widget, and the
  server — so the WebSocket boundary is type-safe end to end.
- **Concurrency correctness.** Two agents claiming the same conversation can never both win: the claim
  is an atomic conditional write (`UPDATE ... WHERE status = 'unassigned'`), and rows-affected decides
  winner vs. conflict — not an application-level check.
- **Secure third-party embedding.** The widget runs on arbitrary sites in a sandboxed iframe, authed
  with short-lived HMAC-signed tickets scoped to one `workspace + visitor`. A visitor connection can
  only ever subscribe to its own conversation — never `workspace:*` or another visitor's thread.
  Host-site identities are verifiable with Intercom-style HMAC signatures (timing-safe comparison,
  per-workspace secret, optional enforcement).
- **Multi-tenancy with auth scoping.** Every query is scoped by workspace membership and role;
  internal notes are filtered **server-side** before they ever reach a visitor socket.
- **Production hardening.** Rate limiting on every public and auth endpoint (per-IP and per-account
  brute-force throttles, per-visitor message caps), a full password-reset flow with single-use
  hashed tokens, transactional email (Resend) for resets and team invites, a per-workspace
  **domain allowlist** (a copied site_id can't be embedded on a stranger's site), Sentry error
  tracking, and a real `/api/health` check.
- **Tested where it hurts.** A Vitest suite covers the security-critical invariants: ticket
  signing/tampering/expiry, identity HMAC verification, the domain allowlist (including suffix
  look-alike attacks), rate-limit windows, and agent visibility scoping — `pnpm test`.
- **A deliberate, documented scaling path** (`publish()` → Redis pub/sub) that is intentionally *not*
  built for v1 — see [Scaling](#scaling-the-real-time-layer).

---

## Architecture

### The two-frontend rule
Nuxt powers the **dashboard**, not the widget loader. There are three distinct pieces:

1. **Dashboard** — the full Nuxt 4 app (Control Room, auth, settings). Nitro also serves the REST API
   and the WebSocket handler.
2. **`widget.js` loader** — a tiny vanilla-TypeScript bundle (built with `tsup`) that reads
   `data-site-id` off its own `<script>` tag and injects an isolated iframe. It ships **no framework
   runtime**, so it's safe to drop on any third-party site.
3. **Widget frame** — the chat UI rendered *inside* the iframe (a Nuxt route), sandboxed from the host page.

### One process, single instance
The REST API, the WebSocket handler, the in-process pub/sub bus, and the presence registry all run in
**one Nitro process**. That's a deliberate v1 choice: in-memory fan-out needs no Redis, but it does
mean the real-time layer is single-instance. The scaling path is documented below and isolated to one file.

### Real-time event contract (the spine)
Two channels carry everything:

| Channel | Subscribers | Purpose |
|---|---|---|
| `workspace:{id}` | online agents in the workspace | inbox events: new conversation, assignment, presence |
| `conversation:{id}` | agents viewing it + the visitor | message stream, typing, read receipts |

All mutations happen over REST and fan out via `publish()` / `publishFiltered()`; the WS handler owns
only the connection lifecycle, authorized subscription, presence, and typing relay. Agent visibility is
enforced with a `publishFiltered(channel, event, predicate)` that checks each peer's role/member id
against the conversation's assignee.

### Tech stack (all free / free-tier)

| Concern | Choice |
|---|---|
| Framework | Nuxt 4 + Nitro (one app = frontend + API + WS) |
| Real-time | Nitro WebSockets (`defineWebSocketHandler`, crossws) |
| UI | Tailwind + Nuxt UI |
| Language | TypeScript everywhere (shared types across all boundaries) |
| Database | Postgres on Neon (serverless) |
| ORM | Drizzle (schema + migrations) |
| Dashboard auth | nuxt-auth-utils (sealed cookie sessions) |
| Visitor auth | short-lived HMAC-signed WS tickets scoped to `site_id` + `visitor_id` |
| Hosting | Render (single long-lived Nitro process) |

---

## Monorepo layout

```
perch/
├── app/                    # Nuxt dashboard + widget frame (pages, composables, components)
├── server/
│   ├── api/                # REST endpoints (auth, workspaces, conversations, widget)
│   ├── routes/api/ws.ts    # the WebSocket handler
│   └── utils/              # db, realtime (publish/subscribe), presence, ws-ticket
├── packages/
│   ├── shared/             # the §6 event contract: events, models, enums (type-safe everywhere)
│   ├── db/                 # Drizzle schema + migrations
│   └── widget-loader/      # vanilla TS → builds widget.js (the embeddable file)
├── Dockerfile              # multi-stage build → self-contained Nitro .output
└── PRD.md                  # the product spec this was built against
```

---

## Local development

**Prerequisites:** Node 22+, [pnpm](https://pnpm.io) 11+, and a Neon (or any Postgres) database.

```bash
# 1. install
pnpm install

# 2. create a .env at the repo root with the two vars below
#    (drizzle-kit and the app both read it from the repo root)

# 3. run migrations against your database
pnpm --filter @perch/db db:migrate

# 4. build the embeddable widget once
pnpm --filter @perch/widget-loader build

# 5. start the dev server (http://localhost:2222)
pnpm dev
```

Useful scripts: `pnpm build` (production Nitro bundle), `pnpm preview`, `pnpm lint`, `pnpm typecheck`,
`pnpm test` (Vitest — tickets, HMAC identity, domain allowlist, rate limits, visibility scoping).

### Environment variables

| Variable | Purpose |
|---|---|
| `NEON_CONNECTION_STRING` | Postgres connection string (Neon or any Postgres) |
| `NUXT_SESSION_PASSWORD` | 32+ char secret — seals auth cookies **and** signs the HMAC WS tickets |
| `RESEND_API_KEY` | *(optional)* transactional email — password resets + invite emails. Without it, emails are logged to the server console |
| `RESEND_FROM` | *(optional)* from address, e.g. `Perch <no-reply@yourdomain.com>` |
| `SENTRY_DSN` | *(optional)* server-side error tracking; the client DSN lives in `sentry.client.config.ts` |

> Nuxt only auto-maps `NUXT_`-prefixed env at runtime, so the server also reads these two names
> directly from `process.env` — set them as plain environment variables in production.

---

## Deployment

The whole app is one Nitro process, so it deploys as a single service on a host that supports
**long-lived WebSocket connections** (Render, Fly, a VM — *not* Vercel/Netlify/Cloud Run, which don't
hold persistent sockets). The included multi-stage `Dockerfile` produces a self-contained
`.output` and runs `node .output/server/index.mjs`.

Notes from getting this live on a free tier:
- The Nitro build can OOM on small builders — the Dockerfile raises V8's heap
  (`--max-old-space-size=4096`) and server/client sourcemaps are disabled in `nuxt.config.ts`.
- `/api/health` is the real health check (process + database). Point uptime monitoring there —
  pinging `/` proves nothing, since the landing page is prerendered.
- Free-tier services that sleep on idle break presence; an UptimeRobot monitor on `/api/health`
  every 5 minutes keeps both the instance and Neon's compute warm.
- Errors report to Sentry (`@sentry/nuxt`); source-map upload is deliberately off to keep builds
  inside the free-tier builder's RAM.

---



## Status & roadmap

**Built:** auth · workspaces & invites · role-scoped Control Room inbox · atomic claim / assign /
reassign · resolve/reopen · per-agent unread · internal notes · live presence · settings & team
management · the embeddable widget with pre-chat, typing, and presence · notification toast + sound.


---

## License

See [LICENSE](LICENSE).
