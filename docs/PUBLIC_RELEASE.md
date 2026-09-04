# Portfolio release checklist

This is an operator checklist, not a certification that every step has passed.

- Scan every Git branch and historical version for secrets with a dedicated
  scanner. Also inspect Actions logs, artifacts, and screenshots. Rotate any
  exposed credentials; deleting a file in a new commit is not sufficient.
- Retain third-party license notices and keep private personal guides out of
  commits. Use `SECURITY.md` for private vulnerability reporting.
- Require CI checks and reviewed changes on protected branches. Enable secret
  scanning and push protection where available.
- Configure the deployed sandbox mode and matching provider/webhook secrets;
  verify the pricing and billing notices after deployment. Never display a
  sandbox claim on a deployment that can charge real money.
- Use your own sample workspace, visitor, email recipients, and webhook receiver.
  Sandbox payments do not make messages, email, or customer data fictional.
- Do not mix live financial history with sandbox billing in one database.
- Run migrations on an isolated test database, lint, typecheck, regression tests,
  the widget build, and the application build before promotion.
- Exercise visitor message → claim → reply → reassignment → internal mention →
  resolve, including two workspaces, failed sends, reconnects, and mobile layouts.
- Confirm the single-replica deployment constraint and review backup restoration,
  worker health, and delivery failures using `LAUNCH_OPERATIONS.md`.
- Keep demo screenshots free of real customer records and secrets. Describe
  actual behavior and known limitations rather than unsupported scale claims.

Changing repository visibility cannot recall copies or existing public forks.
The owner should review repository settings, public Actions history, and provider
configuration directly before publication or enabling real-money collection.
