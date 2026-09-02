# Perch launch and deployment operations

This is the practical checklist for deploying and operating Perch. It separates safeguards the application enforces itself from settings that must be configured in Railway, Neon, Bachs, and other providers.

## What the application enforces

- Production refuses to start without a valid PostgreSQL URL, a strong session secret, an HTTPS public origin, and complete transactional-email settings for account recovery.
- Optional provider credentials must be complete sets. For example, Perch will not start with a Bachs API key but no explicit environment and webhook secret.
- Signed-in API changes must come from the exact Perch origin. Bachs webhooks and the public widget installation handshake are the only intentional cross-origin exceptions.
- API bodies are limited to 2 MB before JSON parsing. Image uploads have their stricter existing 1 MB file limit.
- API responses are marked `no-store`, sessions are cookie-only, and production cookies are secure, HTTP-only, and SameSite=Lax.
- Dashboard and API pages cannot be framed. The widget remains frameable only by domains allowed for that workspace.
- `/api/live` checks that the process is running. `/api/health` checks the signing configuration and database and returns `503` without internal error details when the service is not ready.
- CI applies migrations to disposable PostgreSQL, audits production dependencies, runs lint/type-check/tests, builds the widget, and builds the production server.
- Production builds do not contact remote font catalogues. The current committed CSS uses reliable system fallbacks; add brand fonts as reviewed local assets rather than making releases depend on a third-party metadata service.

## Railway settings

- Set `PERCH_PUBLIC_URL` as an exact HTTPS origin such as `https://useperch.xyz`. Do not add a path or trailing content.
- Set the Docker build argument `PERCH_PUBLIC_URL` as well as the runtime variable so prerendered canonical links use the public domain.
- Configure the readiness/health check path as `/api/health` with a timeout longer than the database connection timeout. Use `/api/live` only when Railway supports a separate liveness probe.
- Keep HTTPS redirect enabled at the edge. HSTS is sent by Perch in production, but TLS termination and certificate renewal belong to Railway.
- Run one application replica until realtime fan-out, presence, rate limits, background-job claiming, and session/member authorization invalidation use shared infrastructure. Role changes, member removal, and session revocation disconnect affected sockets immediately on the replica that handled the change, but another replica would need the same invalidation over shared pub/sub. In-memory coordination is intentionally single-instance today.
- Set CPU and memory limits, watch restart count and memory pressure, and keep at least one previous known-good image available for rollback.
- Send application logs to a retained log destination. Alert on repeated `5xx` responses, failed health checks, restart loops, and background sweep failures.
- Retain structured `[data-deletion-receipt]` log records for longer than the backup window. They contain internal IDs but no email, chat text, or password. Restrict access to operators.

## Database safety

- Enable Neon backups or point-in-time recovery before production traffic.
- Schedule `scripts/backup.sh` on an always-on service and copy its archive plus checksum to private storage outside Neon and Railway.
- Test restoring with `scripts/restore-verify.sh` into a fresh separate database. A backup that has never been restored is not yet proven.
- Record a successful restore drill before launch and repeat it at least monthly.
- Before a restored database serves traffic, replay every retained `data_deletion.completed` receipt created after the archive timestamp, then verify those account/workspace IDs no longer exist.
- Keep production, staging, CI, and local database credentials separate.
- The container applies migrations before starting the server. Review every migration before deploy and do not edit a migration that has already run.
- For a rollback, prefer a forward-compatible application rollback. Do not automatically reverse a migration that may already contain user data.

## Secrets and provider setup

- Generate `NUXT_SESSION_PASSWORD` and optional `REALTIME_SECRET` independently with at least 32 random characters.
- Rotate a session secret as an incident response action: it signs everyone out. Rotate the realtime secret at the same time only when it is separate.
- Configure Google client ID, client secret, and the exact HTTPS redirect URL together.
- Configure Resend API key and verified sender together. Railway staging also runs with `NODE_ENV=production`, so it needs separate staging/test Resend credentials rather than the local-development console fallback. Monitor delivery failures and domain authentication.
- Configure `BACHS_ENV`, the API key, and webhook secret together. Use `sandbox` with a sandbox key on staging and `live` with a live key in production; Perch refuses mismatched credentials. Verify the production webhook URL and signature secret before launch.
- Keep `PERCH_BILLING_CHECKOUT_ENABLED=false` until the full sandbox checkout, canonical payment confirmation, renewal, cancellation, payment-failure, and reconciliation journeys pass. The server rejects new checkout attempts while this gate is off, even if a client calls the API directly. Turning it off does not disable existing entitlements, cancellation, or signed Bachs webhook processing.
- Keep `VISITOR_REPLY_EMAIL_FEATURE_ENABLED=false` until the visitor email privacy review and both dedicated secrets are complete. While this gate is false, Settings and the widget do not expose the feature and opt-in requests fail closed. Disabled deployments do not need either visitor-email secret.
- Before enabling exposure, generate `VISITOR_REPLY_SECRET` and `VISITOR_EMAIL_HASH_SECRET` independently with at least 32 random characters each. Rotating the reply secret invalidates outstanding return and unsubscribe links. The hash secret is deliberately separate and stable: do not rotate or remove it while suppression or delivery records exist, because old keyed hashes would no longer match.
- Keep `VISITOR_REPLY_EMAIL_DELIVERY_ENABLED=false` until visitor-email processing through Resend is explicitly approved, feature exposure is enabled, the scheduled delivery worker is registered, and the staging journey below passes. The worker utility refuses its production transport while this gate is false; injected test transports remain available for safe automated verification.
- Keep `PERCH_WEBHOOK_DELIVERY_ENABLED=false` until outbound conversation-data delivery has been approved for the deployment. While disabled, Perch neither stores new webhook payloads nor sends them, so enabling it later does not release a surprise backlog. Before enabling it, review every configured destination and subscription, then monitor the oldest due job, retry volume, and dead-letter count. Delivery workers use `SKIP LOCKED`, recover claims older than ten minutes, stop after six attempts, and retain terminal history for 30 days.
- Configure and verify a signed Resend webhook before enabling visitor reply delivery so bounces and complaints create durable hashed-email suppressions. `RESEND_WEBHOOK_SECRET` documents the required secret, but webhook handling is not implemented in this branch because provider credentials and dashboard setup are external prerequisites. Until it exists, do not enable production visitor delivery.
- Configure all three Cloudinary values together. Upload controls stay unavailable until the complete set is present, while already-sent images continue to render. Keep upload presets private; uploads pass through Perch's signed, authenticated proxy.
- Never paste secret values into tickets, screenshots, commits, or logs.

## Release and incident checklist

1. Confirm CI is green, including migrations, dependency audit, widget build, and server build.
2. Confirm required environment variables exist in the target environment without copying values into chat or logs.
3. Deploy to staging and exercise login, widget installation, message send/reply, attachments, billing sandbox, and webhook delivery.
   For outbound webhooks, confirm the gate is intentionally set. Create two endpoints subscribed to the same event; verify each receives the same event ID once, signatures use the current secret, a 503 schedules a retry, a 422 becomes **Needs attention**, replay is available only to admins, disabling cancels queued work, and no audit or error log exposes a URL path or query.
   For visitor reply email, use a disposable address: leave the consent box clear and confirm no job is eligible; opt in explicitly; leave the widget; send one public agent reply; confirm one generic email; use the return link once; confirm reuse fails; reply from the exact private thread; then unsubscribe and confirm later turns stay suppressed. Also confirm internal notes, already-read replies, spam, blocks, changed email addresses, and non-consenting visitors never send.
4. Confirm `/api/live` and `/api/health` return `200` and API responses contain `X-Request-Id`.
5. Deploy production and watch health, errors, restart count, database connections, and provider dashboards.
6. If health fails, stop routing traffic or roll back the application image. Preserve the database and logs for diagnosis.
7. After an incident, rotate affected credentials, verify webhook signatures and sessions, reconcile provider state, and document the cause and recovery.
