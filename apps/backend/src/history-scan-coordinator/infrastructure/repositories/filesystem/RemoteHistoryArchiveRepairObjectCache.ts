import { link, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { HistoryArchiveRepairObjectRepresentation } from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';

export class HistoryArchiveRepairObjectCacheError extends Error {}

export async function retainVerifiedBucket(input: {
	readonly bucketCacheDirectory: string;
	readonly contentDigest: string;
	readonly contentRepresentation: HistoryArchiveRepairObjectRepresentation;
	readonly objectIdentity: string;
	readonly stagedFilePath: string;
}): Promise<void> {
	if (!input.objectIdentity.startsWith('bucket:')) return;
	if (
		input.objectIdentity !== `bucket:${input.contentDigest}` ||
		input.contentRepresentation !== 'uncompressed-xdr'
	) {
		throw new HistoryArchiveRepairObjectCacheError(
			'Bucket repair identity does not match verified content'
		);
	}

	const root = resolve(input.bucketCacheDirectory);
	const destination = resolve(
		root,
		input.contentDigest.slice(0, 2),
		input.contentDigest.slice(2, 4),
		`${input.contentDigest}.xdr.gz`
	);
	if (!isWithin(root, destination)) {
		throw new HistoryArchiveRepairObjectCacheError(
			'Bucket repair destination escaped the cache root'
		);
	}

	await mkdir(dirname(destination), { mode: 0o700, recursive: true });
	try {
		await link(input.stagedFilePath, destination);
	} catch (error) {
		if (errorCode(error) !== 'EEXIST') {
			throw new HistoryArchiveRepairObjectCacheError(
				'Could not retain verified bucket bytes'
			);
		}
	}
}

function isWithin(rootDirectory: string, filePath: string): boolean {
	const pathFromRoot = relative(rootDirectory, filePath);
	return (
		pathFromRoot !== '..' &&
		!pathFromRoot.startsWith(`..${sep}`) &&
		!isAbsolute(pathFromRoot)
	);
}

function errorCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return null;
	}
	return typeof error.code === 'string' ? error.code : null;
}
