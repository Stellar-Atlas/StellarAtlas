import { normalizeHistoryArchiveRootUrl } from 'shared';
import type { HistoryStateBucketDTO } from 'history-scanner-dto';
import type { HistoryArchiveStateSnapshot } from '../history-archive-state/HistoryArchiveStateSnapshot.js';
import { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from './HistoryArchiveObject.js';

const checkpointFrequency = 64;
const defaultCheckpointDiscoveryPageSize = 1;
export const maxCheckpointDiscoveryPageSize = 256;
const publicNetworkPassphrase =
	'Public Global Stellar Network ; September 2015';
const firstPublicNetworkScpCheckpoint = 0x0012867f;
const zeroHashPattern = /^0+$/;
const bucketHashPattern = /^[0-9a-f]{64}$/i;

const objectOrderByType: Record<HistoryArchiveObjectType, number> = {
	'history-archive-state': 0,
	'checkpoint-state': 10,
	ledger: 20,
	transactions: 30,
	results: 40,
	scp: 45,
	bucket: 50
};

export function buildHistoryArchiveObjectsFromState(
	snapshot: HistoryArchiveStateSnapshot
): readonly HistoryArchiveObject[] {
	if (snapshot.status !== 'available' || snapshot.rawState === null) return [];

	const archiveUrl = normalizeHistoryArchiveRootUrl(snapshot.archiveUrl);
	if (archiveUrl === null) return [];

	const objects: HistoryArchiveObject[] = [
		new HistoryArchiveObject({
			archiveUrl,
			archiveUrlIdentity: snapshot.archiveUrlIdentity,
			objectKey: 'root',
			objectOrder: objectOrderByType['history-archive-state'],
			objectType: 'history-archive-state',
			objectUrl: snapshot.stateUrl
		})
	];

	const checkpointLedger = getCheckpointLedger(snapshot.rawState.currentLedger);
	if (checkpointLedger !== null) {
		objects.push(
			createCheckpointObject(
				snapshot,
				archiveUrl,
				checkpointLedger,
				'checkpoint-state'
			)
		);
	}

	return dedupeObjects(objects);
}

export function buildCheckpointSiblingObjectsFromState(
	snapshot: HistoryArchiveStateSnapshot,
	options: { readonly expectedCheckpointLedger?: number | null } = {}
): readonly HistoryArchiveObject[] {
	if (snapshot.status !== 'available' || snapshot.rawState === null) return [];
	const archiveUrl = normalizeHistoryArchiveRootUrl(snapshot.archiveUrl);
	if (archiveUrl === null) return [];

	const checkpointLedger = getCheckpointLedger(snapshot.rawState.currentLedger);
	if (checkpointLedger === null) return [];
	if (
		options.expectedCheckpointLedger !== undefined &&
		options.expectedCheckpointLedger !== null &&
		checkpointLedger !== options.expectedCheckpointLedger
	) {
		return [];
	}

	const objects: HistoryArchiveObject[] = [
		createCheckpointObject(snapshot, archiveUrl, checkpointLedger, 'ledger'),
		createCheckpointObject(
			snapshot,
			archiveUrl,
			checkpointLedger,
			'transactions'
		),
		createCheckpointObject(snapshot, archiveUrl, checkpointLedger, 'results')
	];
	if (isScpArchiveObjectExpected(snapshot, checkpointLedger)) {
		objects.push(
			createCheckpointObject(snapshot, archiveUrl, checkpointLedger, 'scp')
		);
	}

	for (const bucketHash of getBucketHashes(snapshot.rawState.currentBuckets)) {
		objects.push(createBucketObject(snapshot, archiveUrl, bucketHash));
	}
	for (const bucketHash of getBucketHashes(
		snapshot.rawState.hotArchiveBuckets ?? []
	)) {
		objects.push(createBucketObject(snapshot, archiveUrl, bucketHash));
	}

	return dedupeObjects(objects);
}

export function buildCheckpointStateDiscoveryObjects(
	snapshot: HistoryArchiveStateSnapshot,
	options: {
		readonly maxObjects?: number;
		readonly oldestScheduledCheckpointLedger?: number | null;
	} = {}
): readonly HistoryArchiveObject[] {
	if (snapshot.status !== 'available' || snapshot.rawState === null) return [];
	const archiveUrl = normalizeHistoryArchiveRootUrl(snapshot.archiveUrl);
	if (archiveUrl === null) return [];

	const latestCheckpointLedger = getCheckpointLedger(
		snapshot.rawState.currentLedger
	);
	if (latestCheckpointLedger === null) return [];

	const pageSize = normalizeDiscoveryPageSize(options.maxObjects);
	const startLedger =
		options.oldestScheduledCheckpointLedger === null ||
		options.oldestScheduledCheckpointLedger === undefined
			? latestCheckpointLedger
			: Math.min(
					latestCheckpointLedger,
					options.oldestScheduledCheckpointLedger - checkpointFrequency
				);

	const objects: HistoryArchiveObject[] = [];
	for (
		let checkpointLedger = startLedger;
		checkpointLedger >= checkpointFrequency - 1 && objects.length < pageSize;
		checkpointLedger -= checkpointFrequency
	) {
		objects.push(
			createCheckpointObject(
				snapshot,
				archiveUrl,
				checkpointLedger,
				'checkpoint-state'
			)
		);
	}

	return objects;
}

export function buildRootHistoryArchiveObject(
	archiveUrl: string
): HistoryArchiveObject | null {
	const normalizedArchiveUrl = normalizeHistoryArchiveRootUrl(archiveUrl);
	if (normalizedArchiveUrl === null) return null;

	return new HistoryArchiveObject({
		archiveUrl: normalizedArchiveUrl,
		archiveUrlIdentity: normalizedArchiveUrl.toLowerCase(),
		objectKey: 'root',
		objectOrder: objectOrderByType['history-archive-state'],
		objectType: 'history-archive-state',
		objectUrl: `${normalizedArchiveUrl}/.well-known/stellar-history.json`
	});
}

function createCheckpointObject(
	snapshot: HistoryArchiveStateSnapshot,
	archiveUrl: string,
	checkpointLedger: number,
	objectType: Exclude<
		HistoryArchiveObjectType,
		'history-archive-state' | 'bucket'
	>
): HistoryArchiveObject {
	const category = objectType === 'checkpoint-state' ? 'history' : objectType;
	const extension = objectType === 'checkpoint-state' ? 'json' : 'xdr.gz';
	const checkpointHex = toCheckpointHex(checkpointLedger);

	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: snapshot.archiveUrlIdentity,
		checkpointLedger,
		objectKey: `${objectType}:${checkpointHex}`,
		objectOrder: objectOrderByType[objectType],
		objectType,
		objectUrl: `${archiveUrl}/${category}/${checkpointHex.slice(0, 2)}/${checkpointHex.slice(2, 4)}/${checkpointHex.slice(4, 6)}/${category}-${checkpointHex}.${extension}`
	});
}

function createBucketObject(
	snapshot: HistoryArchiveStateSnapshot,
	archiveUrl: string,
	bucketHash: string
): HistoryArchiveObject {
	const normalizedHash = bucketHash.toLowerCase();

	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: snapshot.archiveUrlIdentity,
		bucketHash: normalizedHash,
		objectKey: `bucket:${normalizedHash}`,
		objectOrder: objectOrderByType.bucket,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket/${normalizedHash.slice(0, 2)}/${normalizedHash.slice(2, 4)}/${normalizedHash.slice(4, 6)}/bucket-${normalizedHash}.xdr.gz`
	});
}

function getCheckpointLedger(currentLedger: number): number | null {
	if (!Number.isSafeInteger(currentLedger) || currentLedger < 0) return null;
	if (currentLedger < checkpointFrequency - 1) return checkpointFrequency - 1;

	return (
		Math.floor((currentLedger + 1) / checkpointFrequency) *
			checkpointFrequency -
		1
	);
}

function getBucketHashes(
	buckets: readonly HistoryStateBucketDTO[]
): readonly string[] {
	const hashes: string[] = [];
	for (const bucket of buckets) {
		hashes.push(bucket.curr, bucket.snap);
		if (bucket.next.output) hashes.push(bucket.next.output);
	}

	return hashes
		.map((hash) => hash.toLowerCase())
		.filter(
			(hash) => bucketHashPattern.test(hash) && !zeroHashPattern.test(hash)
		);
}

function isScpArchiveObjectExpected(
	snapshot: HistoryArchiveStateSnapshot,
	checkpointLedger: number
): boolean {
	if (checkpointLedger >= firstPublicNetworkScpCheckpoint) return true;

	const networkPassphrase = snapshot.rawState?.networkPassphrase ?? null;
	if (networkPassphrase === null || networkPassphrase === undefined)
		return false;

	return networkPassphrase !== publicNetworkPassphrase;
}

function toCheckpointHex(checkpointLedger: number): string {
	return checkpointLedger.toString(16).padStart(8, '0');
}

function normalizeDiscoveryPageSize(value?: number): number {
	if (value === undefined) return defaultCheckpointDiscoveryPageSize;
	if (!Number.isSafeInteger(value) || value < 1) return 1;
	return Math.min(value, maxCheckpointDiscoveryPageSize);
}

function dedupeObjects(
	objects: readonly HistoryArchiveObject[]
): readonly HistoryArchiveObject[] {
	const objectsByIdentity = new Map<string, HistoryArchiveObject>();
	for (const object of objects) {
		objectsByIdentity.set(
			`${object.archiveUrlIdentity}:${object.objectType}:${object.objectKey}`,
			object
		);
	}

	return Array.from(objectsByIdentity.values());
}
