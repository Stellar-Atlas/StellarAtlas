import type { DataSource, QueryRunner } from 'typeorm';
import { EventType } from '../../domain/event/Event.js';
import {
	archiveNotificationFindingLimit,
	type ArchiveSourcePlan
} from '../../domain/subscription/ArchiveFindingState.js';
import { findingTransaction, integer, queryRows } from './ArchiveFindingSql.js';

export async function acknowledgeArchiveFindings(
	source: DataSource,
	plans: readonly ArchiveSourcePlan[]
): Promise<void> {
	if (plans.length === 0) return;
	if (
		plans.reduce((sum, plan) => sum + plan.findings.length, 0) >
			archiveNotificationFindingLimit ||
		plans.some((plan) => plan.userId !== plans[0]?.userId)
	)
		throw new Error('Invalid archive acknowledgement batch');
	await findingTransaction(source, async (runner) => {
		const active = await queryRows(
			runner,
			`SELECT s.id FROM subscription s JOIN subscription_subscriber subscriber ON subscriber.id = s."subscriberId"
			WHERE s.id = ANY($1::integer[]) AND subscriber."userIdValue" = $2 ORDER BY s.id FOR UPDATE OF s`,
			[plans.map((plan) => plan.subscriptionId), plans[0]?.userId]
		);
		const ids = new Set(active.map((row) => integer(row.id)));
		for (const plan of plans) {
			if (!ids.has(plan.subscriptionId)) continue;
			// Subscription/source identity is immutable; confirmation replaces the row.
			const matching = await queryRows(
				runner,
				`SELECT id FROM subscription WHERE id = $1 AND "eventSourceId"->>'type' = 'PublicKey' AND "eventSourceId"->>'id' = $2`,
				[plan.subscriptionId, plan.sourceKey]
			);
			if (matching.length !== 1) continue;
			let fresh = 0,
				acknowledged = 0;
			for (const finding of plan.findings) {
				const updated = await queryRows(
					runner,
					`UPDATE archive_integrity_notification_state SET "deliveredFingerprint" = $3,
					"deliveredObservationAt" = $4, "deliveredAt" = transaction_timestamp(), "acknowledgedGeneration" = $5
					WHERE "subscriptionId" = $1 AND "findingKey" = $2 AND NOT "observationConflicted" AND "observedAt" >= $4
					AND "deliveryGeneration" = $5::bigint AND "acknowledgedGeneration" IS DISTINCT FROM $5::bigint
					AND ("observedAt" > $4 OR "observedFingerprint" = $3)
					AND ("deliveredObservationAt" IS NULL OR "deliveredObservationAt" < $4 OR ("deliveredObservationAt" = $4 AND "deliveredFingerprint" = $3)) RETURNING "findingKey"`,
					[
						plan.subscriptionId,
						finding.key,
						finding.fingerprint,
						finding.observedAt.toISOString(),
						finding.generation
					]
				);
				if (updated.length === 1) {
					fresh++;
					acknowledged++;
				} else {
					const repeated = await queryRows(
						runner,
						`SELECT "findingKey" FROM archive_integrity_notification_state WHERE "subscriptionId" = $1 AND "findingKey" = $2 AND "deliveryGeneration" = $3::bigint AND "acknowledgedGeneration" = $3::bigint`,
						[plan.subscriptionId, finding.key, finding.generation]
					);
					if (repeated.length === 1) acknowledged++;
				}
			}
			if (fresh > 0)
				await acknowledgeSource(
					runner,
					plan,
					acknowledged === plan.findings.length
				);
		}
	});
}

async function acknowledgeSource(
	runner: QueryRunner,
	plan: ArchiveSourcePlan,
	complete: boolean
): Promise<void> {
	// Clear only intent selected true, before advancing the timestamp token ourselves.
	if (complete)
		for (const intent of plan.unmute) {
			await runner.query(
				`UPDATE subscription_event_notification_state SET "ignoreCoolOffPeriod" = false WHERE id = $1 AND "eventSubscriptionId" = $2
			AND "eventType" = $3 AND "ignoreCoolOffPeriod" = true AND "latestSendTime" = $4`,
				[
					intent.id,
					plan.subscriptionId,
					EventType.HistoryArchiveErrorDetected,
					intent.latestSendTime.toISOString()
				]
			);
		}
	const latest = new Date(
		Math.max(...plan.findings.map((finding) => finding.observedAt.getTime()))
	);
	await runner.query(
		`UPDATE subscription_event_notification_state SET "latestSendTime" = GREATEST("latestSendTime", $3::timestamptz) WHERE "eventSubscriptionId" = $1 AND "eventType" = $2`,
		[
			plan.subscriptionId,
			EventType.HistoryArchiveErrorDetected,
			latest.toISOString()
		]
	);
	await runner.query(
		`INSERT INTO subscription_event_notification_state ("eventSubscriptionId", "eventType", "latestSendTime", "ignoreCoolOffPeriod")
		SELECT id, $2, $3, false FROM subscription WHERE id = $1 AND NOT EXISTS (
			SELECT 1 FROM subscription_event_notification_state WHERE "eventSubscriptionId" = $1 AND "eventType" = $2)`,
		[
			plan.subscriptionId,
			EventType.HistoryArchiveErrorDetected,
			latest.toISOString()
		]
	);
}
