import { createHash } from 'node:crypto';
import {
	EXPERT_DIRECTORY_SOURCE,
	MAX_EXPERT_RECORD_BYTES,
	isGitOid,
	parseExpertDirectoryPath,
	parseExpertDirectoryRecord,
	type DirectoryAddress,
	type ExpertDirectoryRecord
} from './ExpertDirectoryRecord.js';

export const MAX_EXPERT_DELTA_PATHS = 128;
export const MAX_EXPERT_DELTA_BYTES = 512 * 1024;
export const MAX_EXPERT_SNAPSHOT_PATHS = 16_384;
export const MAX_EXPERT_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export type ExpertDirectoryChange =
	| {
			readonly kind: 'upsert';
			readonly path: string;
			readonly previousBlobOid: string | null;
			readonly blobOid: string;
			readonly bytes: Uint8Array;
	  }
	| {
			readonly kind: 'delete';
			readonly path: string;
			readonly previousBlobOid: string;
	  };

/** A complete path-filtered change set from the pinned Git trees, produced by a trusted local adapter. */
export interface ExpertDirectoryDelta {
	readonly source: typeof EXPERT_DIRECTORY_SOURCE;
	readonly complete: boolean;
	readonly fromCommit: string;
	readonly toCommit: string;
	readonly observedAt: string;
	readonly changes: readonly ExpertDirectoryChange[];
}

interface Observation {
	readonly commit: string;
	readonly observedAt: string;
}

export type ExpertDirectoryEntry =
	| (ExpertDirectoryRecord & Observation & { readonly state: 'active' })
	| (DirectoryAddress &
			Observation & {
				readonly state: 'deleted';
				readonly source: typeof EXPERT_DIRECTORY_SOURCE;
				readonly sourcePath: string;
				readonly previousBlobOid: string;
			});

export interface ExpertDirectoryCheckpoint extends Observation {
	readonly previousCommit: string | null;
	readonly deltaSha256: string | null;
}

export interface ExpertDirectoryTransaction {
	readCheckpoint(
		source: typeof EXPERT_DIRECTORY_SOURCE
	): Promise<ExpertDirectoryCheckpoint | null>;
	readEntry(
		source: typeof EXPERT_DIRECTORY_SOURCE,
		address: string
	): Promise<ExpertDirectoryEntry | null>;
	writeEntry(entry: ExpertDirectoryEntry): Promise<void>;
	advanceCheckpoint(
		source: typeof EXPERT_DIRECTORY_SOURCE,
		expectedCommit: string,
		checkpoint: ExpertDirectoryCheckpoint
	): Promise<void>;
}

export interface ExpertDirectoryStore {
	/**
	 * Expose one source-isolated transaction. Commit all writes together, roll
	 * back on rejection, and reject a concurrent change of the expected checkpoint.
	 * Retrying the transaction callback must use a fresh consistent snapshot.
	 */
	transaction<T>(
		work: (transaction: ExpertDirectoryTransaction) => Promise<T>
	): Promise<T>;
}

export interface ExpertDirectoryHistory {
	/** Verify ancestry using the same pinned repository that produced the complete delta. */
	isAncestor(fromCommit: string, toCommit: string): Promise<boolean>;
}

interface PreparedChange {
	readonly previousBlobOid: string | null;
	readonly entry: ExpertDirectoryEntry;
}

/** Apply a bounded delta after an independently staged initial checkpoint. */
export async function applyExpertDirectoryDelta(
	delta: ExpertDirectoryDelta,
	history: ExpertDirectoryHistory,
	store: ExpertDirectoryStore
): Promise<{
	readonly status: 'applied' | 'replayed';
	readonly checkpoint: ExpertDirectoryCheckpoint;
}> {
	const { changes, checkpoint, fromCommit } = prepare(delta);
	if (!(await history.isAncestor(fromCommit, checkpoint.commit)))
		throw new Error(
			'Directory target is not a descendant of the source commit'
		);

	return store.transaction(async (tx) => {
		const current = await tx.readCheckpoint(EXPERT_DIRECTORY_SOURCE);
		if (current?.commit === checkpoint.commit) {
			if (
				current.previousCommit !== fromCommit ||
				current.deltaSha256 !== checkpoint.deltaSha256
			)
				throw new Error(
					'Directory commit replay does not match the accepted delta'
				);
			return { status: 'replayed', checkpoint: current };
		}
		if (current?.commit !== fromCommit)
			throw new Error('Directory checkpoint does not match the delta base');

		for (const { entry, previousBlobOid } of changes) {
			const old = await tx.readEntry(EXPERT_DIRECTORY_SOURCE, entry.address);
			if (
				(old &&
					(old.address !== entry.address ||
						old.source !== EXPERT_DIRECTORY_SOURCE ||
						old.sourcePath !== entry.sourcePath)) ||
				(old?.state === 'active' ? old.sourceBlobOid : null) !== previousBlobOid
			)
				throw new Error(
					'Directory entry does not match its expected predecessor'
				);
			await tx.writeEntry(entry);
		}
		await tx.advanceCheckpoint(EXPERT_DIRECTORY_SOURCE, fromCommit, checkpoint);
		return { status: 'applied', checkpoint };
	});
}

function prepare(delta: ExpertDirectoryDelta): {
	readonly fromCommit: string;
	readonly changes: readonly PreparedChange[];
	readonly checkpoint: ExpertDirectoryCheckpoint;
} {
	const { source, fromCommit, toCommit, observedAt, changes } = delta;
	const timestamp =
		typeof observedAt === 'string' && observedAt.length <= 64
			? Date.parse(observedAt)
			: NaN;
	if (
		source !== EXPERT_DIRECTORY_SOURCE ||
		delta.complete !== true ||
		!isGitOid(fromCommit) ||
		!isGitOid(toCommit) ||
		fromCommit === toCommit ||
		!Number.isFinite(timestamp) ||
		!Array.isArray(changes) ||
		changes.length > MAX_EXPERT_DELTA_PATHS
	)
		throw new Error('Invalid or incomplete directory delta');

	const seen = new Set<string>();
	const prepared: PreparedChange[] = [];
	let bytes = 0;
	const observation = {
		commit: toCommit,
		observedAt: new Date(timestamp).toISOString()
	};
	for (const change of changes as readonly ExpertDirectoryChange[]) {
		const { path, previousBlobOid } = change;
		const identity = parseExpertDirectoryPath(path);
		if (seen.has(path)) throw new Error('Duplicate directory path');
		seen.add(path);
		if (previousBlobOid !== null && !isGitOid(previousBlobOid))
			throw new Error('Invalid directory predecessor blob');

		if (change.kind === 'upsert') {
			if (
				!(change.bytes instanceof Uint8Array) ||
				change.bytes.byteLength > MAX_EXPERT_RECORD_BYTES ||
				(bytes += change.bytes.byteLength) > MAX_EXPERT_DELTA_BYTES ||
				change.blobOid === previousBlobOid
			)
				throw new Error('Invalid or oversized directory delta blob');
			const record = parseExpertDirectoryRecord(
				path,
				change.blobOid,
				change.bytes
			);
			prepared.push({
				previousBlobOid,
				entry: { ...record, ...observation, state: 'active' }
			});
		} else if (change.kind === 'delete' && previousBlobOid !== null) {
			prepared.push({
				previousBlobOid,
				entry: {
					...identity,
					...observation,
					state: 'deleted',
					source: EXPERT_DIRECTORY_SOURCE,
					sourcePath: path,
					previousBlobOid
				}
			});
		} else {
			throw new Error('Invalid directory change');
		}
	}
	prepared.sort((left, right) =>
		left.entry.sourcePath < right.entry.sourcePath ? -1 : 1
	);
	const deltaSha256 = createHash('sha256')
		.update(
			JSON.stringify(
				prepared.map(({ previousBlobOid, entry }) => [
					entry.sourcePath,
					previousBlobOid,
					entry.state === 'active' ? entry.sourceBlobOid : null,
					entry.state === 'active' ? entry.contentSha256 : null
				])
			)
		)
		.digest('hex');
	return {
		fromCommit,
		changes: prepared,
		checkpoint: {
			...observation,
			previousCommit: fromCommit,
			deltaSha256
		}
	};
}
