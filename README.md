# Perch

Customer support without the clutter. Add a chat widget to your website and manage conversations, team discussions and help articles in one place.

[Try Perch](https://useperch.xyz) · [Pricing](https://useperch.xyz/pricing)

## Features

- **Live chat:** an embeddable widget with typing indicators, read receipts and visitor context.
- **Shared inbox:** assign and reassign conversations, add internal notes, mention teammates and organize chats with tags, priorities and saved views.
- **Team collaboration:** Nest team chat, notifications and role-based workspace access.
- **Self-service support:** a searchable help center available on the web and inside the widget.
- **Automation:** route conversations, send proactive messages, remind agents about unanswered chats and close inactive conversations.
- **Reporting and billing:** support analytics, response targets and workspace subscriptions.

## Try it out

Create a workspace and follow the Installation steps to add the widget to a page you control. Send a message from a separate browser session, then reply from the inbox. Invite a teammate to try reassignment and mentions.

Use your own test data. When checkout is marked as sandbox, use only test payment details. Emails, uploads and outgoing webhooks can still be real.

## Built with

Nuxt 4, Vue, TypeScript, Nuxt UI, Tailwind CSS, Nitro WebSockets, PostgreSQL and Drizzle ORM. Integrations include Google sign-in, Resend, Cloudinary and Bachs.

The dashboard, API and WebSocket server run together in one application instance. Background jobs are stored in PostgreSQL and wait between scheduled tasks instead of constantly polling empty queues.

## Run locally

Requires Node.js 22+, pnpm 11+ and a local PostgreSQL database.

```bash
pnpm install
cp .env.example .env
```

Set `NEON_CONNECTION_STRING` to your **local** database, generate a 32+ character `NUXT_SESSION_PASSWORD`, and keep `PERCH_PUBLIC_URL=http://localhost:2222`. See [.env.example](.env.example) for optional integrations.

```bash
pnpm --filter @perch/db db:migrate
pnpm --filter @perch/widget-loader build
pnpm dev
```

Open [localhost:2222](http://localhost:2222). Development emails are logged to the terminal instead of sent.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For database integration tests, set `TEST_DATABASE_URL` to an isolated test database and run `pnpm test --no-file-parallelism`. Tests can delete data, so never use staging or production.

## Security and license

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Licensed under [MIT](LICENSE), with the original Nuxt UI template attribution retained.
