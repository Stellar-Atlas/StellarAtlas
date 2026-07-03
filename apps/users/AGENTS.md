# Users Service Agent Guide

Read `../../AGENTS.md` first. `apps/users` is the legacy user/email service:
Express endpoints, TypeORM migrations, Mailgun integration, password hashing,
and encryption utilities used by older Stellarbeat/StellarAtlas flows.

## Purpose

Keep legacy user and mail behavior stable while the broader platform modernizes.
This app is security-sensitive because it handles user data, hashes, tokens, and
email delivery.

## Working Rules

- Prefer strict TypeScript and explicit validation for all request inputs.
- Do not weaken encryption, hashing, token, or migration behavior without a
  direct task and tests.
- Keep source files under 500 lines. Split route handlers, mail helpers, and
  persistence code if they grow.
- Delivery and migration commands must be idempotent where possible because
  services may run under clustered process management.
- Avoid CPU-heavy work in request handlers. If hashing volume becomes high, move
  it to bounded worker threads.
- Do not log secrets, tokens, hashes, or raw personal data.

## Verification

- Build: `pnpm --filter users run build`
- Tests: `pnpm --filter users run test`
- Migration checks: `pnpm --filter users run typeorm:migration:show`
