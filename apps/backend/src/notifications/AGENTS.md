# Notifications Agent Guide

Read `../../../../AGENTS.md` and `../../AGENTS.md` first. `notifications`
handles StellarAtlas subscription flows, message templates, and delivery for
network/node/archive events.

## Purpose

Notifications turn scanner and network evidence into operator-visible messages.
They must be precise, idempotent, and respectful of the difference between
validator/archive faults and StellarAtlas worker or infrastructure faults.

## Code Map

- `domain` contains subscription and message concepts.
- `use-cases` owns subscribe/unsubscribe/mute/confirm behavior.
- `infrastructure/templates` contains email templates copied during
  `apps/backend` post-build.
- `infrastructure` integrates delivery services and persistence.

## Working Rules

- Notification sends must be idempotent across clustered backend processes.
- Do not send archive verification alerts for worker-only failures.
- Keep templates and copy short, factual, and linked to evidence URLs where
  possible.
- Keep user secrets and tokens out of logs.
- Keep files under 500 lines; split template helpers from delivery services.
- CPU-heavy crypto or batching belongs in bounded workers, not request handlers.

## Verification

- Typecheck/build: `pnpm --filter backend run build`
- Focus tests: `pnpm test:unit:backend -- notifications`
