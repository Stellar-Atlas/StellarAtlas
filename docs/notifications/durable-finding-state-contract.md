# Durable finding state: contracts before implementation

Base `f423cdaaa7b365018dcb3f2ea7f9037b2659fa42`; epoch `durable-finding-state-4`. This amends the accepted proposal before schema/code work. The existing archive path, source opt-in and fake transport remain the scope; generic notifications retain their existing behavior.

## 1. Observed evidence and delivered acknowledgement are separate

Key bytes are UTF-8 `JSON.stringify(['archive-finding-key',1,canonicalRoot,objectType,objectKey])`, hashed with SHA256 lowercase hex. Use the existing shared root normalizer, preserving path case/canonical aliases and any private query identity. Never derive identity from the email-redacted view. Object type/key are validated nonempty/control-free native strings; no incidental UUID is part of identity.

Fingerprint bytes are UTF-8 `JSON.stringify(['archive-failure',1,normalizedCode,bucketHashOrNull,checkpointLedgerOrNull])`. Code is trimmed/lowercase with hyphens replaced by underscores; bucket hashes are validated 64-hex and lowercased; checkpoint is a nonnegative safe integer or literal JSON null. Undefined is invalid. Timestamp, event/evidence UUID and raw diagnostic text are excluded. This detects structured evidence changes, not every diagnostic-content change. Observation time is the finite canonical millisecond UTC `event.time` matching `evidenceObservedAt`.

Each `(active subscription ID, finding key)` retains observed timestamp, observed fingerprint and an equal-time-conflict flag independently from delivered fingerprint, delivered observation timestamp, successful acknowledgement time, reserved delivery generation and acknowledged generation.

- Every eligible authoritative candidate advances the observed high-water mark even when unchanged/suppressed, deferred by the bounded mail aggregate or later rejected by transport.
- Older observations cannot change state or send. Equal-time matching observations can retry an unacknowledged delivery. Equal-time conflicting fingerprints persist a conflict flag and send no further variant until strictly newer evidence resolves it. Equal-time distinct objects have independent keys.
- Delivery fields remain null until success and never advance on failure/suppression. Acknowledging an older successful in-flight message may record that delivered observation, but cannot lower the observation watermark or overwrite a newer delivery. Equal-time conflicting delivery acknowledgements fail closed.
- No candidate absence, truncated page or missing finding is treated as recovery. Verified rows leave the existing failed-object query; recovery remains silent. Recurrence is evaluated against retained structured state, not assumed to start a fresh episode.

## 2. One short successful-delivery acknowledgement transaction

Preparation uses short transactions to lock/recheck existing active subscriptions, persist observation state, snapshot source-level unmute intent and reserve a monotonically increasing per-finding delivery generation for eligible evidence. Release all database locks before calling the provider. Existing archive-run advisory locking remains, but is not claimed to serialize user actions.

After each successful recipient notification, use **one** short transaction for all included finding delivery updates, legacy source notification timestamps and selected unmute consumption. Re-lock current subscription rows in stable ID order and recheck the same user/source. Update existing active rows only; never call `SubscriberRepository.save()` on the selected stale aggregate, insert/recreate a subscriber/subscription, or hold the transaction across provider delivery. Missing/deleted/replaced subscriptions are skipped; their finding rows cannot be recreated. FK cascade removes state on unsubscribe/confirmed source replacement.

Observation rows are created during preparation, not acknowledgement. Delivery updates are monotonic and source unmute clears only when all included findings for that source were acknowledged in this transaction. A SQL error anywhere rolls back all delivery fields/timestamp/unmute changes, retaining the independently committed observed watermark. Acknowledgement must match the current reserved delivery generation and records that generation atomically. Repeating an acknowledged generation consumes nothing again; an old generation cannot acknowledge a later reservation or consume a newer intent, including after intervening same-observation resends. Reserving is not delivery: failures leave delivery fields unchanged. A superseded in-flight delivery can remain unacknowledged and retry; this is bounded per-finding bookkeeping, not a queue or a user-intent generation.

An already accepted in-flight message cannot be cancelled. Provider acceptance followed by absent/lost acknowledgement can still cause a duplicate on retry; no exactly-once promise is made. Fresh runs must exclude opted-out sources, and no stale acknowledgement may resurrect them.

## 3. Cooldown, equality and coalesced source unmute

Retain the existing **source-observation timestamp** cooldown intent; wall-clock acknowledgement time is audit data only. For unchanged fingerprints, delivery is eligible only when `observedAt > deliveredObservationAt + 24h`. Equality at exactly 24h remains suppressed. The identical old observation never produces a reminder just because wall time passed. No scheduler/reminder/cleanup service is added. A genuinely changed structured fingerprint is eligible immediately only if it is not stale/conflicted; a failed delivery remains retryable with equal matching evidence.

Existing unmute is one bounded boolean intent per source/event type. Snapshot its existing true rows plus timestamp tokens during preparation. One intent permits **one aggregated notification for that source's current findings**, not one independent permission per finding. Repeated clicks while that boolean is already pending coalesce; no new ticket/generation semantics are invented. Do not clear a newly requested intent if selection saw false. Consume selected true intent only on successful atomic acknowledgement; failures/retries retain it. A delayed replay of an already committed acknowledgement consumes nothing again. Do not force stale or conflicting evidence even when unmuted. Generic notification behavior remains unchanged.

## Bounds and persistence

The new relation contains only subscription ID, private hashes, observation/conflict fields and nullable successful-delivery bookkeeping. Composite primary key `(subscriptionId,findingKey)` supplies indexed point access and FK cascade. No raw root/address/bearer/diagnostic is stored there. Unsalted hashes are private identifiers, not secret redaction or proofs.

Query active sources/current keys in chunks of at most 200. Each source currently has at most 100 candidate objects; reject larger unexpected source batches rather than creating unbounded transactions. A recipient email contains at most 200 findings, keeping complete source groups together; remaining groups defer without clearing intent or acknowledging delivery. Acknowledgement therefore covers at most 200 current finding rows. No eager history relation is added. Stored cardinality can grow over an active subscription's lifetime; there is no invented small-size/retention claim or cleanup daemon.

Acceptance uses an isolated disposable PostgreSQL database and real migration/repositories plus fake mail: reload, stale watermark after suppression/failure, equal-time conflicts/resolution, distinct objects, strict cooldown equality, coalesced unmute/retry/replayed acknowledgement, transactional rollback, unsubscribe/confirm races, FK cascade and bounded lookups. No production migration, runtime enablement or real mail.

## Legacy timestamp-only cutover

An existing active subscription can have successful source-level notification bookkeeping while its new finding table is empty. Until that subscription has its first genuine durable finding acknowledgement, preserve its latest archive-event timestamp as a temporary source-level cooldown gate. Without selected explicit unmute intent, an observation must be strictly later than that timestamp plus 24 hours; equality remains suppressed. This replaces the earlier initial-observation-is-eligible transition policy. When several legacy rows exist, use their latest timestamp rather than depending on database row order.

Observation rows still advance during suppression. Do not infer a delivered fingerprint, delivered observation time, acknowledgement time or generation from legacy state. A changed fingerprint cannot establish that it differs from unknown legacy delivery contents, so it remains behind this temporary gate. Failed sends retain legacy state and are retryable with matching current evidence after the boundary. Explicit unmute retains the existing aggregated-send, failure and successful-acknowledgement behavior.

The first real durable acknowledgement ends this source-level transition gate. Existing per-finding rules then apply, including immediate eligibility for a new key or changed current fingerprint; advancing the compatibility source timestamp must not restart a coarse cooldown for new keys. Legacy state and durable-history eligibility are read under the existing active subscription lock. No backfill, schema change, cleanup job, provider call or new retention promise is introduced.

This remains an observation-time policy, not a wall-clock reminder: an identical old observation does not eventually become new evidence. An observation beyond the finite legacy boundary, or explicit unmute of current non-conflicting evidence, can progress. The coarse history cannot retrospectively distinguish which individual findings were previously mailed; the first later eligible aggregate may therefore repeat a historically delivered finding. Exactly-once provider delivery remains unclaimed.

## Global worker enablement and rollout compatibility

The existing `NOTIFICATIONS_ENABLED` setting maps to `Config.enableNotifications` and defaults to false when absent. The notification DI loader supplies that value to `Notify.execute`. Unless it is true, the worker returns success before archive evidence reads, finding preparation/reservation/acknowledgement, generic network/event reads, subscriber notification generation or provider delivery. This is the global scanner-notification switch, not an archive-only setting. Scan persistence, archiving, heartbeat and frontend revalidation are not suppressed.

With true configuration, the existing archive-first and then generic-event flow, error reporting, recipient selection, cooldowns and provider acknowledgement behavior are unchanged. This is an entry gate, not cancellation of already accepted in-flight messages or a dynamic configuration watcher. Configuration must be evaluated for the process being rolled out.

Direct subscription confirmation and requested unsubscribe-link emails use separate use cases and remain outside this worker gate. Provider bindings, including local SMTP selection, still exist for those flows. Do not describe this setting as an all-email kill switch.

This enforcement is a behavior change: earlier worker code ignored the existing flag. Before deployment, review the effective setting and the expected notification service explicitly. A default or false setting now stops worker notification work; deploying without that review could unintentionally stop a previously expected sender. Conversely, this correction is not permission to set the flag true, activate a provider or apply a migration. Enabling archive delivery still requires the finding-state schema and separately approved opt-in, privacy and provider readiness. Do not solve rollout ambiguity by silently enabling delivery or treating a source merge as sender activation.

### Activation preflight

1. Identify the exact API and network scanner builds and their effective settings separately. The scanner calls `Notify.execute` after scan persistence. Deploying the frontend or API alone leaves scanner delivery unchanged. Keep automatic migrations disabled on ordinary service starts.
2. From the qualified `apps/backend` runtime directory, use the approved database connection to list pending migrations:

   ```bash
   DATABASE_MIGRATIONS_RUN=false node lib/core/infrastructure/cli/database-migrations.js
   ```

   Exit 2 means migrations are pending. The explicit false prevents initialization from applying them during inspection. The archive migration is `ArchiveIntegrityNotificationState1793635200000`. It adds `archive_integrity_notification_state` and `IDX_archive_source_unmute` without a backfill. Review the index lock window and the full pending list before separately authorizing an apply. The CLI's `--apply` option applies **all** pending managed migrations. Stop on an unexpected entry. Confirm the migration history, table, foreign key, constraints and index before enabling the scanner.
3. Verify the existing sender binding and the link base on both processes. With `NOTIFICATIONS_ENABLED=false`, direct confirmation and unsubscribe-link handlers remain callable, but the environment loader uses fallback user-service settings and a localhost frontend base. Do not qualify real direct email with those fallback values. Validate the approved existing transport and effective `FRONTEND_BASE_URL`, including both the notification links and the archive evidence link. A provider accepting a message is only one step. Confirm that the approved test inbox receives it.
4. Enable the qualified scanner only after approving both archive and generic scanner notifications. The switch is global. Use the reviewed gated build and a false scanner setting to hold or stop new worker delivery. Preserve finding state and acknowledgements on application rollback. An older scanner that ignores the switch does not provide this hold.

### Controlled delivery acceptance

Use one approved test inbox and one selected node that advertises an archive root with an eligible finding. The subscription accepts a node source ID. The alert describes the archive root. Request opt-in and check that no archive alert arrives while it is pending. Follow the confirmation link before checking for an eligible observation. Wait for normal scan processing and use existing evidence. Do not manufacture a public failure to trigger a message.

Check one delivered alert for the expected root, object, failure, observation time and archive details link. A newer unchanged observation inside the cooldown should produce no duplicate. Follow the unsubscribe link and verify that later eligible observations produce no further alerts for the test recipient. Record only the result and non-sensitive identifiers. Keep recipient details and link tokens private. Leave the acceptance pending if no eligible observation occurs.
