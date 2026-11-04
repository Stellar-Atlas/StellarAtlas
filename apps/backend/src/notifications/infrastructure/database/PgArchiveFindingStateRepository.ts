import type { DataSource } from 'typeorm';
import { EventType } from '../../domain/event/Event.js';
import {
	archiveFindingChunkSize,
	archiveSourceFindingLimit,
	archiveFindingEligible,
	type ArchiveFinding,
	type ArchiveFindingStateRepository,
	type ArchiveSourcePlan
} from '../../domain/subscription/ArchiveFindingState.js';
import { acknowledgeArchiveFindings } from './AcknowledgeArchiveFindings.js';
import {
	currentFindings,
	date,
	findingTransaction,
	integer,
	observeFindings,
	queryRows,
	snapshot,
	string
} from './ArchiveFindingSql.js';

export class PgArchiveFindingStateRepository implements ArchiveFindingStateRepository {
	constructor(private readonly source: DataSource) {}

	async prepare(
		userId: string,
		findings: readonly ArchiveFinding[]
	): Promise<readonly ArchiveSourcePlan[]> {
		const grouped = new Map<string, ArchiveFinding[]>();
		for (const finding of findings) {
			const source = finding.event.sourceId.value;
			const group = grouped.get(source) ?? [];
			group.push(finding);
			grouped.set(source, group);
		}
		const keys = [...grouped.keys()].sort();
		const plans: ArchiveSourcePlan[] = [];
		for (
			let offset = 0;
			offset < keys.length;
			offset += archiveFindingChunkSize
		) {
			const runner = this.source.createQueryRunner();
			await runner.connect();
			let targets: Record<string, unknown>[];
			try {
				targets = await queryRows(
					runner,
					`SELECT s.id, s."eventSourceId"->>'id' AS "sourceKey" FROM subscription s JOIN subscription_subscriber subscriber ON subscriber.id = s."subscriberId"
					WHERE subscriber."userIdValue" = $1 AND s."eventSourceId"->>'type' = 'PublicKey' AND s."eventSourceId"->>'id' = ANY($2::text[]) ORDER BY s.id`,
					[userId, keys.slice(offset, offset + archiveFindingChunkSize)]
				);
			} finally {
				await runner.release();
			}
			for (const target of targets) {
				const subscriptionId = integer(target.id),
					sourceKey = string(target.sourceKey);
				const current = currentFindings(grouped.get(sourceKey) ?? []);
				if (current.length > archiveSourceFindingLimit)
					throw new Error('Archive source finding limit exceeded');
				const plan = await findingTransaction(this.source, async (runner) => {
					const active = await queryRows(
						runner,
						`SELECT s.id FROM subscription s JOIN subscription_subscriber subscriber ON subscriber.id = s."subscriberId"
						WHERE s.id = $1 AND subscriber."userIdValue" = $2 AND s."eventSourceId"->>'type' = 'PublicKey' AND s."eventSourceId"->>'id' = $3 FOR UPDATE OF s`,
						[subscriptionId, userId, sourceKey]
					);
					if (active.length !== 1 || current.length === 0) return null;
					await observeFindings(runner, subscriptionId, current);
					const rows = await queryRows(
						runner,
						`SELECT * FROM archive_integrity_notification_state WHERE "subscriptionId" = $1 AND "findingKey" = ANY($2::text[])`,
						[subscriptionId, current.map((value) => value.finding.key)]
					);
					const states = new Map(
						rows.map((row) => {
							const state = snapshot(row);
							return [state.key, state];
						})
					);
					const sourceStates = await queryRows(
						runner,
						`SELECT id, "latestSendTime", "ignoreCoolOffPeriod" FROM subscription_event_notification_state WHERE "eventSubscriptionId" = $1 AND "eventType" = $2 FOR UPDATE`,
						[subscriptionId, EventType.HistoryArchiveErrorDetected]
					);
					const unmute = sourceStates
						.filter((row) => row.ignoreCoolOffPeriod === true)
						.map((row) => ({
							id: integer(row.id),
							latestSendTime: date(row.latestSendTime)
						}));
					// A coarse legacy timestamp is only a temporary source-level gate.
					// Never turn it into a successful per-finding delivery record.
					let legacyLatest: number | null = null;
					if (sourceStates.length > 0 && unmute.length === 0) {
						const delivered = await queryRows(
							runner,
							`SELECT EXISTS (SELECT 1 FROM archive_integrity_notification_state WHERE "subscriptionId" = $1 AND "deliveredFingerprint" IS NOT NULL AND "deliveredObservationAt" IS NOT NULL) AS acknowledged`,
							[subscriptionId]
						);
						if (
							delivered.length !== 1 ||
							typeof delivered[0]?.acknowledged !== 'boolean'
						)
							throw new Error('Archive delivery history state missing');
						if (!delivered[0].acknowledged)
							legacyLatest = Math.max(
								...sourceStates.map((row) => date(row.latestSendTime).getTime())
							);
					}
					const eligible = current.flatMap(({ finding }) => {
						const state = states.get(finding.key);
						if (!state) throw new Error('Archive observation state missing');
						if (
							legacyLatest !== null &&
							finding.observedAt.getTime() <= legacyLatest + 24 * 60 * 60 * 1000
						)
							return [];
						return archiveFindingEligible(finding, state, unmute.length > 0)
							? [finding]
							: [];
					});
					const reserved =
						eligible.length === 0
							? []
							: await queryRows(
									runner,
									`UPDATE archive_integrity_notification_state SET "deliveryGeneration" = "deliveryGeneration" + 1
						WHERE "subscriptionId" = $1 AND "findingKey" = ANY($2::text[])
						RETURNING "findingKey", "deliveryGeneration"::text AS generation`,
									[subscriptionId, eligible.map((finding) => finding.key)]
								);
					const generations = new Map(
						reserved.map((row) => [
							string(row.findingKey),
							string(row.generation)
						])
					);
					const deliveries = eligible.map((finding) => {
						const generation = generations.get(finding.key);
						if (!generation)
							throw new Error('Archive delivery reservation missing');
						return { ...finding, generation };
					});
					return {
						subscriptionId,
						userId,
						sourceKey,
						findings: deliveries,
						unmute
					};
				});
				if (plan && plan.findings.length > 0) plans.push(plan);
			}
		}
		return plans;
	}

	acknowledge(plans: readonly ArchiveSourcePlan[]): Promise<void> {
		return acknowledgeArchiveFindings(this.source, plans);
	}
}
