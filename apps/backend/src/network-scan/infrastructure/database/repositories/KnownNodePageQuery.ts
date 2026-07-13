import { Snapshot } from '@core/domain/Snapshot.js';
import type {
	KnownNodeIdentity,
	KnownNodePageRequest,
	KnownNodeRepositoryScope
} from '@network-scan/domain/node/NodeRepository.js';
import type { EntityManager } from 'typeorm';

export interface KnownNodePageSelectionItem {
	readonly hasSnapshot: boolean;
	readonly identity: KnownNodeIdentity;
}

export interface KnownNodePageSelection {
	readonly items: KnownNodePageSelectionItem[];
	readonly scopeTotals: Record<KnownNodeRepositoryScope, number>;
	readonly total: number;
}

const knownNodesCte = `
	with known_nodes as (
		select node."publicKeyValue" as "publicKey",
			node."dateDiscovered" as "dateDiscovered",
			latest_measurement."time" as "lastMeasurementAt",
			latest_snapshot.id is not null as "hasSnapshot",
			latest_snapshot.ip as "ip",
			latest_snapshot."homeDomain" as "homeDomain",
			node_details."name" as "name",
			node_details."host" as "host",
			case
				when latest_snapshot.id is null then 'public-key-only'
				when latest_snapshot."endDate" <> $1 then 'archived'
				when latest_snapshot."QuorumSetId" is not null then 'current-validator'
				else 'listener'
			end as "scope"
		from "node" node
		left join lateral (
			select snapshot.id,
				snapshot.ip,
				snapshot."homeDomain",
				snapshot."endDate",
				snapshot."QuorumSetId",
				snapshot."NodeDetailsId"
			from "node_snap_shot" snapshot
			where snapshot."NodeId" = node.id
			order by snapshot."endDate" desc,
				snapshot."startDate" desc,
				snapshot.id desc
			limit 1
		) latest_snapshot on true
		left join "node_details" node_details
			on node_details.id = latest_snapshot."NodeDetailsId"
		left join lateral (
			select measurement."time"
			from "node_measurement_v2" measurement
			where measurement."nodeId" = node.id
			order by measurement."time" desc
			limit 1
		) latest_measurement on true
	)
`;

const pageFilter = `
	($2::text = 'all-known' or "scope" = $2::text)
	and (
		$3::text = ''
		or lower("publicKey") like $4::text escape '!'
		or lower(coalesce("name", '')) like $4::text escape '!'
		or lower(coalesce("homeDomain", '')) like $4::text escape '!'
		or lower(coalesce("host", '')) like $4::text escape '!'
		or lower(coalesce("ip", '')) like $4::text escape '!'
		or "publicKey" = any($5::text[])
	)
`;

export async function selectKnownNodePage(
	manager: EntityManager,
	request: KnownNodePageRequest
): Promise<KnownNodePageSelection> {
	const needle = request.query.trim().toLowerCase();
	const parameters: unknown[] = [
		Snapshot.MAX_DATE,
		request.scope,
		needle,
		`%${escapeLikePattern(needle)}%`,
		[...new Set(request.organizationPublicKeys)],
		request.limit,
		request.offset
	];

	const [pageRows, summaryRows] = await Promise.all([
		manager.query(
			`${knownNodesCte}
			select "publicKey", "dateDiscovered", "lastMeasurementAt", "hasSnapshot"
			from known_nodes
			where ${pageFilter}
			order by "publicKey" asc
			limit $6 offset $7`,
			parameters
		) as Promise<KnownNodePageRow[]>,
		manager.query(
			`${knownNodesCte}
			select count(*) filter (where ${pageFilter}) as "matchingCount",
				count(*) as "allKnownCount",
				count(*) filter (where "scope" = 'archived') as "archivedCount",
				count(*) filter (where "scope" = 'current-validator') as "currentValidatorCount",
				count(*) filter (where "scope" = 'listener') as "listenerCount",
				count(*) filter (where "scope" = 'public-key-only') as "publicKeyOnlyCount"
			from known_nodes`,
			parameters.slice(0, 5)
		) as Promise<KnownNodePageSummaryRow[]>
	]);

	const summary = summaryRows[0];
	if (summary === undefined) throw new Error('Known-node page summary is missing');

	return {
		items: pageRows.map((row) => ({
			hasSnapshot: row.hasSnapshot,
			identity: mapKnownNodeIdentity(row)
		})),
		scopeTotals: {
			'all-known': parseCount(summary.allKnownCount),
			archived: parseCount(summary.archivedCount),
			'current-validator': parseCount(summary.currentValidatorCount),
			listener: parseCount(summary.listenerCount),
			'public-key-only': parseCount(summary.publicKeyOnlyCount)
		},
		total: parseCount(summary.matchingCount)
	};
}

interface KnownNodePageRow {
	readonly publicKey: string;
	readonly dateDiscovered: Date | string;
	readonly lastMeasurementAt: Date | string | null;
	readonly hasSnapshot: boolean;
}

interface KnownNodePageSummaryRow {
	readonly allKnownCount: number | string;
	readonly archivedCount: number | string;
	readonly currentValidatorCount: number | string;
	readonly listenerCount: number | string;
	readonly matchingCount: number | string;
	readonly publicKeyOnlyCount: number | string;
}

function mapKnownNodeIdentity(row: KnownNodePageRow): KnownNodeIdentity {
	return {
		publicKey: row.publicKey,
		dateDiscovered: new Date(row.dateDiscovered),
		lastMeasurementAt:
			row.lastMeasurementAt === null
				? null
				: new Date(row.lastMeasurementAt)
	};
}

function parseCount(value: number | string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`Invalid known-node count: ${String(value)}`);
	}
	return count;
}

function escapeLikePattern(value: string): string {
	return value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}
