import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';

export interface NetworkSearchCanonicalArchiveRoot {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
}

export interface NetworkSearchCanonicalArchiveState {
	readonly revision: string;
	readonly roots: readonly NetworkSearchCanonicalArchiveRoot[];
}

export interface NetworkSearchCanonicalArchiveSource {
	load(): Promise<NetworkSearchCanonicalArchiveState>;
}

type CanonicalArchiveDataSource = Pick<DataSource, 'isInitialized' | 'query'>;

interface CanonicalArchiveRow {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly revision: string;
}

export const networkSearchCanonicalArchiveSql = `
	with identities as (
		select "archiveUrlIdentity"
		from history_archive_evidence_root_summary
		union
		select "archiveUrlIdentity"
		from history_archive_checkpoint_proof_rollup
		union
		select "archiveUrlIdentity"
		from history_archive_state_snapshot
	)
	select
		identities."archiveUrlIdentity",
		coalesce(state."archiveUrl", identities."archiveUrlIdentity")
			as "archiveUrl",
		concat_ws(chr(31),
			coalesce(summary."totalObjects"::text, ''),
			coalesce(summary."pendingObjects"::text, ''),
			coalesce(summary."activeObjects"::text, ''),
			coalesce(summary."verifiedObjects"::text, ''),
			coalesce(summary."remoteFailureObjects"::text, ''),
			coalesce(summary."workerIssueObjects"::text, ''),
			coalesce(summary."bucketObjects"::text, ''),
			coalesce(summary."verifiedBucketObjects"::text, ''),
			coalesce(summary."updatedAt"::text, ''),
			coalesce(proof."totalCheckpointProofs"::text, ''),
			coalesce(proof."pendingCheckpointProofs"::text, ''),
			coalesce(proof."verifiedCheckpointProofs"::text, ''),
			coalesce(proof."mismatchCheckpointProofs"::text, ''),
			coalesce(proof."notEvaluableCheckpointProofs"::text, ''),
			coalesce(proof."updatedAt"::text, ''),
			coalesce(state."archiveUrl", ''),
			coalesce(state.status, ''),
			coalesce(state."observedAt"::text, '')
		) as revision
	from identities
	left join history_archive_evidence_root_summary summary
		on summary."archiveUrlIdentity" = identities."archiveUrlIdentity"
	left join history_archive_checkpoint_proof_rollup proof
		on proof."archiveUrlIdentity" = identities."archiveUrlIdentity"
	left join history_archive_state_snapshot state
		on state."archiveUrlIdentity" = identities."archiveUrlIdentity"
	order by identities."archiveUrlIdentity"
`;

export class PostgresNetworkSearchCanonicalArchiveSource implements NetworkSearchCanonicalArchiveSource {
	constructor(
		private readonly dataSource: CanonicalArchiveDataSource = AppDataSource
	) {}

	async load(): Promise<NetworkSearchCanonicalArchiveState> {
		if (!this.dataSource.isInitialized) {
			throw new Error('Canonical archive Postgres source is not initialized');
		}
		const value: unknown = await this.dataSource.query(
			networkSearchCanonicalArchiveSql
		);
		if (!Array.isArray(value)) {
			throw new Error(
				'Canonical archive Postgres source returned invalid rows'
			);
		}
		const rows = value.map(parseRow);
		return {
			revision: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
			roots: rows.map(({ archiveUrl, archiveUrlIdentity }) => ({
				archiveUrl,
				archiveUrlIdentity
			}))
		};
	}
}

function parseRow(value: unknown): CanonicalArchiveRow {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('archiveUrl' in value) ||
		!('archiveUrlIdentity' in value) ||
		!('revision' in value) ||
		typeof value.archiveUrl !== 'string' ||
		typeof value.archiveUrlIdentity !== 'string' ||
		typeof value.revision !== 'string' ||
		value.archiveUrl.length === 0 ||
		value.archiveUrlIdentity.length === 0
	) {
		throw new Error(
			'Canonical archive Postgres source returned an invalid row'
		);
	}
	return {
		archiveUrl: value.archiveUrl,
		archiveUrlIdentity: value.archiveUrlIdentity,
		revision: value.revision
	};
}
