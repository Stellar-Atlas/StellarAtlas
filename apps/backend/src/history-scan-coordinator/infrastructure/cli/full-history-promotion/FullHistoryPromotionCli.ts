import type { DataSource } from 'typeorm';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import type { FullHistoryWriteReceipt } from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import type { FullHistoryPromotionTarget } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import { FullHistoryPromotionError } from '../../../domain/full-history-promotion/FullHistoryPromotionError.js';
import { parseHistoryArchiveUrl } from '../../../domain/ArchiveUrlIdentity.js';
import {
	composeFullHistoryCheckpointPromoter,
	createFullHistoryPromotionDataSource
} from './FullHistoryPromotionComposition.js';
import {
	checkFullHistoryPromotionSchemaReadiness,
	type FullHistoryPromotionSchemaReadiness
} from './FullHistoryPromotionSchemaReadiness.js';

const maximumOutputBytes = 4_096;
const maximumErrorMessageLength = 384;
const operatorConfirmation = 'promote-one-checkpoint';
const passphraseEnvironmentKey = 'FULL_HISTORY_NETWORK_PASSPHRASE';
const confirmationEnvironmentKey = 'FULL_HISTORY_PROMOTION_OPERATOR_CONFIRM';

export const FULL_HISTORY_PROMOTION_USAGE_EXIT_CODE = 64;
export const FULL_HISTORY_PROMOTION_EVIDENCE_EXIT_CODE = 65;
export const FULL_HISTORY_PROMOTION_SCHEMA_EXIT_CODE = 69;
export const FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE = 75;

interface WritableOutput {
	write(value: string): unknown;
}

export interface FullHistoryPromotionCliDependencies {
	readonly checkReadiness: (
		dataSource: DataSource
	) => Promise<FullHistoryPromotionSchemaReadiness>;
	readonly createDataSource: () => DataSource;
	readonly promote: (
		dataSource: DataSource,
		target: FullHistoryPromotionTarget
	) => Promise<FullHistoryWriteReceipt>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
}

const defaultDependencies: FullHistoryPromotionCliDependencies = {
	checkReadiness: checkFullHistoryPromotionSchemaReadiness,
	createDataSource: createFullHistoryPromotionDataSource,
	promote: (dataSource, target) =>
		composeFullHistoryCheckpointPromoter(dataSource).promote(target),
	stderr: process.stderr,
	stdout: process.stdout
};

export async function runFullHistoryPromotionCli(
	argv: readonly string[] = process.argv,
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: FullHistoryPromotionCliDependencies = defaultDependencies
): Promise<number> {
	let target: FullHistoryPromotionTarget;
	try {
		target = parseFullHistoryPromotionTarget(argv, environment);
	} catch (error) {
		writeBoundedJson(dependencies.stderr, {
			code: 'invalid-arguments',
			message: safeErrorMessage(error),
			status: 'refused'
		});
		return FULL_HISTORY_PROMOTION_USAGE_EXIT_CODE;
	}

	let dataSource: DataSource | null = null;
	let exitCode = FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE;
	try {
		dataSource = dependencies.createDataSource();
		assertSafeDataSource(dataSource);
		await dataSource.initialize();
		const readiness = await dependencies.checkReadiness(dataSource);
		if (!readiness.ready) {
			writeBoundedJson(dependencies.stderr, {
				code: readiness.pendingMigrations
					? 'pending-migrations'
					: 'schema-not-ready',
				missingSchemaObjects: readiness.missingSchemaObjects.slice(0, 32),
				pendingMigrations: readiness.pendingMigrations,
				status: 'refused'
			});
			exitCode = FULL_HISTORY_PROMOTION_SCHEMA_EXIT_CODE;
		} else {
			const receipt = await dependencies.promote(dataSource, target);
			writeBoundedJson(dependencies.stdout, {
				archiveUrlIdentity: target.archiveUrlIdentity,
				batchId: receipt.batchId,
				checkpointLedger: target.checkpointLedger,
				nextLedger: receipt.nextLedger,
				status: receipt.replayed ? 'replayed' : 'promoted'
			});
			exitCode = 0;
		}
	} catch (error) {
		const evidenceFailure =
			error instanceof FullHistoryPromotionError ||
			error instanceof FullHistoryCanonicalError;
		writeBoundedJson(dependencies.stderr, {
			code: evidenceFailure ? 'evidence-refused' : 'promotion-unavailable',
			message: safeErrorMessage(error),
			status: 'failed'
		});
		exitCode = evidenceFailure
			? FULL_HISTORY_PROMOTION_EVIDENCE_EXIT_CODE
			: FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE;
	} finally {
		if (dataSource?.isInitialized) {
			try {
				await dataSource.destroy();
			} catch (error) {
				writeBoundedJson(dependencies.stderr, {
					code: 'cleanup-failed',
					message: safeErrorMessage(error),
					status: 'failed'
				});
				exitCode = FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE;
			}
		}
	}
	return exitCode;
}

export function parseFullHistoryPromotionTarget(
	argv: readonly string[],
	environment: NodeJS.ProcessEnv
): FullHistoryPromotionTarget {
	let archiveValue: string | undefined;
	let checkpointValue: string | undefined;
	let confirmed = false;
	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--confirm-exact-checkpoint') {
			if (confirmed)
				throw new Error('Confirmation flag must appear exactly once');
			confirmed = true;
			continue;
		}
		if (argument === '--archive-url-identity') {
			if (archiveValue !== undefined)
				throw new Error('Archive flag is duplicated');
			archiveValue = readFlagValue(argv, ++index, argument);
			continue;
		}
		if (argument === '--checkpoint-ledger') {
			if (checkpointValue !== undefined)
				throw new Error('Checkpoint flag is duplicated');
			checkpointValue = readFlagValue(argv, ++index, argument);
			continue;
		}
		throw new Error(`Unsupported argument ${boundedText(argument ?? '', 80)}`);
	}
	if (!confirmed) throw new Error('Exact-checkpoint confirmation is required');
	if (environment[confirmationEnvironmentKey] !== operatorConfirmation) {
		throw new Error('Operator environment confirmation is required');
	}
	const archiveUrlIdentity = parseHistoryArchiveUrl(archiveValue ?? '');
	if (
		archiveUrlIdentity === null ||
		Buffer.byteLength(archiveUrlIdentity) > 2_048
	) {
		throw new Error('Archive identity must be one valid HTTP(S) archive root');
	}
	if (!/^[0-9]+$/.test(checkpointValue ?? '')) {
		throw new Error('Checkpoint must be one unsigned decimal ledger');
	}
	const checkpointLedger = Number(checkpointValue);
	if (
		!Number.isSafeInteger(checkpointLedger) ||
		checkpointLedger < 63 ||
		checkpointLedger > 0xffff_ffff ||
		checkpointLedger % 64 !== 63
	) {
		throw new Error(
			'Checkpoint must be one globally aligned checkpoint ledger'
		);
	}
	const networkPassphrase = environment[passphraseEnvironmentKey];
	if (
		typeof networkPassphrase !== 'string' ||
		networkPassphrase.trim().length === 0 ||
		Buffer.byteLength(networkPassphrase) > 1_024
	) {
		throw new Error(`${passphraseEnvironmentKey} must contain one passphrase`);
	}
	return { archiveUrlIdentity, checkpointLedger, networkPassphrase };
}

function readFlagValue(
	argv: readonly string[],
	index: number,
	flag: string
): string {
	const value = argv[index];
	if (value === undefined || value.startsWith('--')) {
		throw new Error(`${flag} requires one value`);
	}
	return value;
}

function assertSafeDataSource(dataSource: DataSource): void {
	if (
		dataSource.options.migrationsRun === true ||
		dataSource.options.synchronize
	) {
		throw new Error(
			'Promotion DataSource must disable migration and synchronization'
		);
	}
}

function writeBoundedJson(output: WritableOutput, value: object): void {
	const serialized = JSON.stringify(value);
	if (Buffer.byteLength(serialized) <= maximumOutputBytes) {
		output.write(`${serialized}\n`);
		return;
	}
	output.write(
		`${JSON.stringify({ code: 'output-bound-exceeded', status: 'failed' })}\n`
	);
}

function safeErrorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	return boundedText(
		raw.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]'),
		maximumErrorMessageLength
	);
}

function boundedText(value: string, maximumLength: number): string {
	return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maximumLength);
}
