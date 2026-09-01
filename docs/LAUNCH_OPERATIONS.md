# Perch launch and deployment operations

This is the practical checklist for deploying and operating Perch. It separates safeguards the application enforces itself from settings that must be configured in Railway, Neon, Bachs, and other providers.

## What the application enforces

- Production refuses to start without a valid PostgreSQL URL, a strong session secret, an HTTPS public origin, and complete transactional-email settings for account recovery.
- Optional provider credentials must be complete sets. For example, Perch will not start with a Bachs API key but no Bachs webhook secret.
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
- Run one application replica until realtime fan-out, presence, rate limits, and background-job claiming use shared infrastructure. In-memory coordination is intentionally single-instance today.
- Set CPU and memory limits, watch restart count and memory pressure, and keep at least one previous known-good image available for rollback.
- Send application logs to a retained log destination. Alert on repeated `5xx` responses, failed health checks, restart loops, and background sweep failures.

## Database safety

- Enable Neon backups or point-in-time recovery before production traffic.
- Test restoring a backup into a separate database. A backup that has never been restored is not yet proven.
- Keep production, staging, CI, and local database credentials separate.
- The container applies migrations before starting the server. Review every migration before deploy and do not edit a migration that has already run.
- For a rollback, prefer a forward-compatible application rollback. Do not automatically reverse a migration that may already contain user data.

## Secrets and provider setup

- Generate `NUXT_SESSION_PASSWORD` and optional `REALTIME_SECRET` independently with at least 32 random characters.
- Rotate a session secret as an incident response action: it signs everyone out. Rotate the realtime secret at the same time only when it is separate.
- Configure Google client ID, client secret, and the exact HTTPS redirect URL together.
- Configure Resend API key and verified sender together. Monitor delivery failures and domain authentication.
- Configure Bachs API and webhook secrets together. Keep sandbox keys on staging and verify the production webhook URL and signature secret before launch.
- Configure all three Cloudinary values together. Keep upload presets private; uploads pass through Perch's signed, authenticated proxy.
- Never paste secret values into tickets, screenshots, commits, or logs.

## Release and incident checklist

1. Confirm CI is green, including migrations, dependency audit, widget build, and server build.
2. Confirm required environment variables exist in the target environment without copying values into chat or logs.
3. Deploy to staging and exercise login, widget installation, message send/reply, attachments, billing sandbox, and webhook delivery.
4. Confirm `/api/live` and `/api/health` return `200` and API responses contain `X-Request-Id`.
5. Deploy production and watch health, errors, restart count, database connections, and provider dashboards.
6. If health fails, stop routing traffic or roll back the application image. Preserve the database and logs for diagnosis.
7. After an incident, rotate affected credentials, verify webhook signatures and sessions, reconcile provider state, and document the cause and recovery.
