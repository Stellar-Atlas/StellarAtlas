import { createHash } from 'node:crypto';
import { constants, open, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION,
	assertFullHistoryLedgerCloseMetaProcessingReceipt,
	type FullHistoryLedgerCloseMetaProcessingReceipt,
	type FullHistoryLedgerCloseMetaProcessingRequest
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import {
	parseGoFullHistoryLedgerCloseMetaManifest,
	processingManifestIdentity,
	type GoFullHistoryLedgerCloseMetaReceipt
} from './GoFullHistoryLedgerCloseMetaReceipt.js';

const maximumManifestBytes = 4 << 20;
const maximumPublishedEntries = 64;

interface VerificationRequest {
	readonly networkName: string;
	readonly outputPath: string;
	readonly receipt: GoFullHistoryLedgerCloseMetaReceipt;
	readonly request: FullHistoryLedgerCloseMetaProcessingRequest;
	readonly typedOutputRoot: string;
}

export async function verifyGoFullHistoryLedgerCloseMetaPublication(
	verification: VerificationRequest
): Promise<FullHistoryLedgerCloseMetaProcessingReceipt> {
	const { receipt, request } = verification;
	assertNetwork(verification);
	assertSourcesMatch(request, receipt);
	const manifestPath = childPath(
		verification.typedOutputRoot,
		verification.outputPath,
		receipt.manifestStorageKey
	);
	const manifestBytes = await readBoundedFile(
		manifestPath,
		maximumManifestBytes
	);
	if (sha256(manifestBytes) !== receipt.manifestSha256) {
		throw new Error('Full-history ETL manifest hash does not match receipt');
	}
	const manifest = parseGoFullHistoryLedgerCloseMetaManifest(
		parseJson(manifestBytes)
	);
	if (
		processingManifestIdentity(manifest) !== processingManifestIdentity(receipt)
	) {
		throw new Error('Full-history ETL receipt and manifest disagree');
	}
	await verifyOutputFiles(verification, manifestPath);
	const processing: FullHistoryLedgerCloseMetaProcessingReceipt = {
		manifestSha256: receipt.manifestSha256,
		outputs: receipt.outputs,
		range: receipt.range,
		sourceDisposition: FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION,
		sourceObjects: receipt.sourceObjects.map((source, index) => {
			const identity = request.inputs[index]!.object.identity;
			return Object.freeze({
				...source,
				...(identity.etag === undefined ? {} : { etag: identity.etag }),
				generation: identity.generation
			});
		})
	};
	assertFullHistoryLedgerCloseMetaProcessingReceipt(processing);
	return Object.freeze(processing);
}

function assertNetwork(verification: VerificationRequest): void {
	const expectedNetworkId = sha256(
		Buffer.from(verification.request.networkPassphrase, 'utf8')
	);
	if (
		verification.receipt.network.name !== verification.networkName ||
		verification.receipt.network.networkIdSha256 !== expectedNetworkId
	) {
		throw new Error('Full-history ETL receipt identifies another network');
	}
}

function assertSourcesMatch(
	request: FullHistoryLedgerCloseMetaProcessingRequest,
	receipt: GoFullHistoryLedgerCloseMetaReceipt
): void {
	if (receipt.sourceObjects.length !== request.inputs.length) {
		throw new Error('Full-history ETL receipt has another source-object count');
	}
	for (const [index, input] of request.inputs.entries()) {
		const evidence = receipt.sourceObjects[index];
		if (
			evidence === undefined ||
			evidence.objectKey !== input.object.identity.objectKey ||
			evidence.range.startSequence !== input.expectedRange.startSequence ||
			evidence.range.endSequence !== input.expectedRange.endSequence ||
			evidence.compressedByteCount !== input.object.bytes.byteLength ||
			evidence.compressedSha256 !== sha256(input.object.bytes)
		) {
			throw new Error(
				'Full-history ETL receipt does not match its transient inputs'
			);
		}
	}
	const first = request.inputs[0]!;
	const last = request.inputs.at(-1)!;
	if (
		receipt.range.startSequence !== first.expectedRange.startSequence ||
		receipt.range.endSequence !== last.expectedRange.endSequence
	) {
		throw new Error('Full-history ETL receipt has another aggregate range');
	}
}

async function verifyOutputFiles(
	verification: VerificationRequest,
	manifestPath: string
): Promise<void> {
	const expectedFiles = new Set<string>([
		relative(verification.outputPath, manifestPath)
	]);
	for (const output of verification.receipt.outputs) {
		const pathname = childPath(
			verification.typedOutputRoot,
			verification.outputPath,
			output.storageKey
		);
		const identity = await hashRegularFile(pathname, output.byteCount);
		if (identity.sha256 !== output.sha256) {
			throw new Error(`Full-history ETL ${output.dataset} hash mismatch`);
		}
		expectedFiles.add(relative(verification.outputPath, pathname));
	}
	const actualFiles = await listPublishedFiles(verification.outputPath);
	if (!sameStringSet(expectedFiles, actualFiles)) {
		throw new Error('Full-history ETL published unexpected files');
	}
}

function childPath(
	root: string,
	outputPath: string,
	storageKey: string
): string {
	if (storageKey.includes('\\')) {
		throw new Error('Full-history ETL storage key contains a backslash');
	}
	const candidate = resolve(root, storageKey);
	if (!isStrictChild(outputPath, candidate)) {
		throw new Error(
			'Full-history ETL storage key escapes its output directory'
		);
	}
	return candidate;
}

async function readBoundedFile(
	pathname: string,
	maximumBytes: number
): Promise<Buffer> {
	const handle = await open(
		pathname,
		constants.O_RDONLY | constants.O_NOFOLLOW
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
			throw new Error(`Full-history ETL file has invalid size: ${pathname}`);
		}
		return await handle.readFile();
	} finally {
		await handle.close();
	}
}

async function hashRegularFile(
	pathname: string,
	expectedBytes: number
): Promise<{ readonly sha256: string }> {
	const handle = await open(
		pathname,
		constants.O_RDONLY | constants.O_NOFOLLOW
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size !== expectedBytes) {
			throw new Error(`Full-history ETL output size mismatch: ${pathname}`);
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1 << 20);
		let position = 0;
		while (position < stat.size) {
			const { bytesRead } = await handle.read(
				buffer,
				0,
				Math.min(buffer.byteLength, stat.size - position),
				position
			);
			if (bytesRead === 0) throw new Error(`Unexpected EOF: ${pathname}`);
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		return { sha256: hash.digest('hex') };
	} finally {
		await handle.close();
	}
}

async function listPublishedFiles(outputPath: string): Promise<Set<string>> {
	const files = new Set<string>();
	const directories = [outputPath];
	let entriesSeen = 0;
	while (directories.length > 0) {
		const directory = directories.pop()!;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			entriesSeen += 1;
			if (entriesSeen > maximumPublishedEntries) {
				throw new Error('Full-history ETL output contains too many entries');
			}
			const pathname = join(directory, entry.name);
			if (entry.isDirectory()) directories.push(pathname);
			else if (entry.isFile()) files.add(relative(outputPath, pathname));
			else throw new Error('Full-history ETL output contains a special file');
		}
	}
	return files;
}

function sameStringSet(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>
): boolean {
	return (
		left.size === right.size && [...left].every((value) => right.has(value))
	);
}

function isStrictChild(parent: string, candidate: string): boolean {
	const child = relative(resolve(parent), resolve(candidate));
	return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`);
}

function parseJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
	} catch (error) {
		throw new Error('Full-history ETL manifest is not valid JSON', {
			cause: error
		});
	}
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
