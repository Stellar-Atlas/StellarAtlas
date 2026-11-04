# Archive unchanged-failure deduplication: persistence boundary

Base: signed privacy successor `b9930050a22651df089a3857315c1cc50b66400f`. This milestone first reproduces the defect through the real archive notification use case, real subscriber/domain filtering, real Notifier and real EJS renderer, with a local capturing `IUserService`. It does not enable email or claim a durable fix has shipped.

## Why the existing stored state cannot support the correction

`EventNotificationState` persists only event type, latest send/observation time and an unmute flag, under a source subscription. It stores no archive root, object identity or failure fingerprint. Two different failures observed at the same time therefore produce identical stored notification state. The fixture explicitly compares that projection. Conversely a repeated unchanged failure with a later observation time bypasses the archive cool-off and sends again, even after the current stored fields have been written to disk and reconstructed in a fresh repository/service instance.

A time-only suppression would hide genuine changed-error alerts. One latest fingerprint per event type is also insufficient: alternating object A/B can re-alert unchanged A or suppress a simultaneous B. Persisting an unbounded map or eagerly loading one new state per historical object into `Subscriber.find()` would introduce memory growth; that is not a safe minimal correction.

## Exact minimum safe persistence proposal, before schema expansion

Add a dedicated small state relation for the existing notification path, rather than overloading timestamp/type fields or creating another delivery service:

| Column | Contract |
| --- | --- |
| `subscriptionId` | Existing active `subscription.id` foreign key, `ON DELETE CASCADE`; pending email requests have no active source subscription to reference. |
| `findingKey` | 64-character SHA256 of a versioned canonical tuple of archive root identity, object type and object key. Distinguish root queries privately; do not strip them or print them in mail. |
| `fingerprint` | 64-character SHA256 of a versioned tuple of structured failure code, expected bucket hash and checkpoint identity. Exclude observation timestamp, incidental evidence UUID and raw diagnostic message. |
| `lastDeliveredObservationAt` | Last acknowledged source observation time, for rejecting regressing evidence. |
| `lastDeliveredAt` | Successful delivery acknowledgement time, for explicit cooldown/reminder semantics. |

Composite primary key `(subscriptionId, findingKey)` is the upsert/lookup index. Store no address, raw root, bearer reference or diagnostic text in this relation. Hashes identify private state; they are not authentication proofs or a guarantee that low-entropy secret inputs cannot be guessed.

Concrete proposed migration body (a review artifact only, not executed):

```sql
CREATE TABLE "archive_integrity_notification_state" (
  "subscriptionId" integer NOT NULL REFERENCES "subscription"("id") ON DELETE CASCADE,
  "findingKey" varchar(64) NOT NULL CHECK ("findingKey" ~ '^[0-9a-f]{64}$'),
  "fingerprint" varchar(64) NOT NULL CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  "lastDeliveredObservationAt" timestamptz NOT NULL,
  "lastDeliveredAt" timestamptz NOT NULL,
  PRIMARY KEY ("subscriptionId", "findingKey")
);
```

The corresponding down operation drops only this new relation. Existing timestamp/type state is not backfilled into invented fingerprints. Initial observation after migration is therefore eligible once. Scope the future source change to this entity/repository/migration, the existing archive notification use case and DI, the small domain unmute/acknowledgement seam and focused fixtures; no HTTP routes, provider, scheduler or unrelated configuration.

Add a repository port used inside the **existing** `NotifyHistoryArchiveIntegrityFailures` run lock. Query state only for the current candidate keys and active subscriptions, in bounded parameterized chunks (proposed maximum 200 pairs). Do not attach this table as an eager relation on Subscriber. A single nullable fingerprint on the old per-type row or an in-memory Set does not satisfy the multi-object/durable requirement.

The existing source's per-type timestamp gate must no longer suppress already-approved rich integrity events after this per-finding decision. Preserve generic network/node notifications and explicitly carry the existing source-level unmute intent into the new decision; consume that intent only after successful delivery. Save/upsert state only for successfully delivered notifications, under the existing archive run lock, with active-subscription foreign-key enforcement. Do not claim exactly-once mail: provider acceptance followed by timeout or failed acknowledgement remains an unresolved send/ack boundary without a durable transport idempotency contract.

Proposed explicit policy for review before implementation:

- An unchanged fingerprint is suppressed during the existing 24-hour cooldown, regardless of a newer observation timestamp. After cooldown, a single reminder is eligible; unchanged is not silently claimed to mean permanent suppression.
- A genuine structured fingerprint change or newly seen object is eligible immediately, subject to active opt-in. Older source observations must not roll state backwards. Same-time distinct objects remain independent.
- Explicit unmute permits one resend and is consumed only after successful delivery.
- Recovery is silent in this slice. A missing finding from a bounded candidate page is **not** evidence of recovery and must not erase acknowledgement state. A verified object leaves candidates; recurrence of the same failure within cooldown remains suppressed, while a changed fingerprint remains eligible. No recovery-email promise or complete recovery detector is introduced.
- Successful unsubscribe removes source subscriptions and cascades associated state. A fresh run cannot select the deleted subscription. This does not promise cancellation of a message already selected/in flight.

This proposal needs a normal source migration plus isolated PostgreSQL acceptance before any runtime use. It requires no new queue, daemon, provider, email service or production scan. This milestone intentionally records the persistence contract and its tests before expanding the schema; no migration file, database call or production persistence correction has been applied here.

## Executable reproduction and next persistence tests

The `notify-history-archive-integrity/__fixtures__/unchanged-failure.repro.ts` fixture is explicitly selected by the private runner; it is not a normal CI assertion that the buggy behavior should remain. The file-backed adapter writes and reloads only the **actual current** stored fields and active/pending subscription state. Its domain reconstruction is a test adapter, not a TypeORM/PostgreSQL durability test. The capturing transport accepts only a reserved `.invalid` fixture address and opaque fixture user ID; no sockets or mail provider are used.

The controlled checks cover advancing-time duplicates, identical-time suppression, changed errors, active opt-in/confirmation, unsubscribe, silent removal/reappearance, successful-only acknowledgement and the stored-state information collision. Raw diagnostic markers must not appear in captured HTML.

Observed milestone result: **8 reproduction checks pass**, establishing the current behavior rather than claiming a fix. The unchanged failure sends twice after a one-millisecond timestamp increase and disk reload; two distinct failures yield the same persisted columns; a same-time second object is suppressed by the per-type state. Confirmation and fresh-run unsubscribe exclusions hold, and a rejected fake send leaves acknowledgement empty so retry succeeds. Silent absence/reappearance is modeled by the bounded candidate repository returning no findings; it is not claimed as a verified recovery transition. **49 inherited regressions and the scoped strict TypeScript check also pass.**

The first runner attempt stopped before reproduction because the retained frontend-only dependency layout lacked workspace dependencies/types. The private runner then linked only already-installed root/backend packages and mapped workspace types to their existing source. No install, project compiler weakening, production edit or test-assertion relaxation was used. Initial diagnostics remain in private evidence. None of these checks exercises PostgreSQL, SMTP, Mailgun or a server process.

Before implementing the proposal, convert the advancing-time counterexample into a one-notification acceptance assertion and add:

1. Actual migrated PostgreSQL upsert/reload across independent repository instances/processes; composite-key uniqueness and subscription-delete cascade; migration up/down on an isolated test database only.
2. Multiple object A/B and shared/canonical-root cases; advancing times/UUID-only changes suppress; genuine code/bucket/checkpoint change alerts; event order changes do not change identity.
3. Cooldown boundary and explicit-unmute success/failure behavior; out-of-order observations cannot overwrite newer acknowledgements.
4. Failure → verified → same failure and failure → verified → changed failure, with the precise silent-recovery policy above. Absence from a truncated evidence page cannot clear state.
5. Transport failure before acceptance leaves no acknowledgement; retry remains eligible. Provider-accepted/ack-lost ambiguity stays explicit rather than being called exactly-once.
6. Bounded query-size tests show only current candidate keys are loaded, with no eager history collection; opt-in and unsubscribe exclusions remain effective after reload.

No real recipient, credentials, runtime enablement, production migration or server operation is authorized by this document. Other accepted email/privacy and live-docs packets remain frozen.
