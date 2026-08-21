import {
	appendHistoryArchiveRootPath,
	normalizeHistoryArchiveRootUrl
} from 'shared';
import type { HistoryStateBucketDTO } from 'history-scanner-dto';
import type { HistoryArchiveStateSnapshot } from '../history-archive-state/HistoryArchiveStateSnapshot.js';
import { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectStatus,
	HistoryArchiveObjectType
} from './HistoryArchiveObject.js';
import { isHistoryArchiveScpObjectExpected } from './HistoryArchiveObjectScpPolicy.js';

const checkpointFrequency = 64;
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
	snapshot: HistoryArchiveStateSnapshot,
	options: { readonly rootStatus?: HistoryArchiveObjectStatus } = {}
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
			objectUrl: snapshot.stateUrl,
			status: options.rootStatus ?? 'pending'
		})
	];

	if (getCheckpointLedger(snapshot.rawState.currentLedger) !== null) {
		const checkpointObject = createCheckpointObject(
			snapshot,
			archiveUrl,
			checkpointFrequency - 1,
			'checkpoint-state',
			options.rootStatus === 'verified'
		);
		checkpointObject.executionReason = 'canonical-frontier-reserve';
		objects.push(checkpointObject);
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
		createCheckpointObject(
			snapshot,
			archiveUrl,
			checkpointLedger,
			'ledger',
			true
		),
		createCheckpointObject(
			snapshot,
			archiveUrl,
			checkpointLedger,
			'transactions',
			true
		),
		createCheckpointObject(
			snapshot,
			archiveUrl,
			checkpointLedger,
			'results',
			true
		)
	];
	if (
		isHistoryArchiveScpObjectExpected({
			checkpointLedger,
			networkPassphrase: snapshot.rawState.networkPassphrase
		})
	) {
		objects.push(
			createCheckpointObject(
				snapshot,
				archiveUrl,
				checkpointLedger,
				'scp',
				true
			)
		);
	}

	for (const bucketHash of getBucketHashes(snapshot.rawState.currentBuckets)) {
		objects.push(
			createBucketObject(snapshot, archiveUrl, checkpointLedger, bucketHash)
		);
	}
	for (const bucketHash of getBucketHashes(
		snapshot.rawState.hotArchiveBuckets ?? []
	)) {
		objects.push(
			createBucketObject(snapshot, archiveUrl, checkpointLedger, bucketHash)
		);
	}

	return dedupeObjects(objects);
}

export function buildRootHistoryArchiveObject(
	archiveUrl: string
): HistoryArchiveObject | null {
	const normalizedArchiveUrl = normalizeHistoryArchiveRootUrl(archiveUrl);
	if (normalizedArchiveUrl === null) return null;

	return new HistoryArchiveObject({
		archiveUrl: normalizedArchiveUrl,
		archiveUrlIdentity: normalizedArchiveUrl,
		dependencyReady: true,
		objectKey: 'root',
		objectOrder: objectOrderByType['history-archive-state'],
		objectType: 'history-archive-state',
		objectUrl: appendObjectPath(
			normalizedArchiveUrl,
			'.well-known/stellar-history.json'
		)
	});
}

function createCheckpointObject(
	snapshot: HistoryArchiveStateSnapshot,
	archiveUrl: string,
	checkpointLedger: number,
	objectType: Exclude<
		HistoryArchiveObjectType,
		'history-archive-state' | 'bucket'
	>,
	dependencyReady: boolean
): HistoryArchiveObject {
	const category = objectType === 'checkpoint-state' ? 'history' : objectType;
	const extension = objectType === 'checkpoint-state' ? 'json' : 'xdr.gz';
	const checkpointHex = toCheckpointHex(checkpointLedger);

	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: snapshot.archiveUrlIdentity,
		checkpointLedger,
		dependencyReady,
		objectKey: `${objectType}:${checkpointHex}`,
		objectOrder: objectOrderByType[objectType],
		objectType,
		objectUrl: appendObjectPath(
			archiveUrl,
			`${category}/${checkpointHex.slice(0, 2)}/${checkpointHex.slice(2, 4)}/${checkpointHex.slice(4, 6)}/${category}-${checkpointHex}.${extension}`
		)
	});
}

function createBucketObject(
	snapshot: HistoryArchiveStateSnapshot,
	archiveUrl: string,
	checkpointLedger: number,
	bucketHash: string
): HistoryArchiveObject {
	const normalizedHash = bucketHash.toLowerCase();

	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: snapshot.archiveUrlIdentity,
		bucketHash: normalizedHash,
		checkpointLedger,
		dependencyReady: true,
		objectKey: `bucket:${normalizedHash}`,
		objectOrder: objectOrderByType.bucket,
		objectType: 'bucket',
		objectUrl: appendObjectPath(
			archiveUrl,
			`bucket/${normalizedHash.slice(0, 2)}/${normalizedHash.slice(2, 4)}/${normalizedHash.slice(4, 6)}/bucket-${normalizedHash}.xdr.gz`
		)
	});
}

function appendObjectPath(archiveUrl: string, path: string): string {
	const objectUrl = appendHistoryArchiveRootPath(archiveUrl, path);
	if (objectUrl === null) throw new Error('Invalid history archive object URL');
	return objectUrl;
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

function toCheckpointHex(checkpointLedger: number): string {
	return checkpointLedger.toString(16).padStart(8, '0');
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
