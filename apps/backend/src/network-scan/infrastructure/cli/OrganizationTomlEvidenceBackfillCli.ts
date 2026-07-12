import { statfs } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import {
	OrganizationTomlEvidenceBackfill,
	type OrganizationTomlBackfillBatchResult
} from '../database/migrations/OrganizationTomlEvidenceBackfill.js';

const DEFAULT_BATCH_SIZE = 25;
export const ORGANIZATION_TOML_BACKFILL_TEMPORARY_FAILURE_EXIT_CODE = 75;

interface WritableOutput {
	write(value: string): unknown;
}

export interface OrganizationTomlBackfillCliDependencies {
	readonly createDataSource: () => DataSource;
	readonly readAvailableBytes: (path: string) => Promise<bigint>;
	readonly runBatch: (
		dataSource: DataSource,
		batchSize: number,
		availableBytes: bigint
	) => Promise<OrganizationTomlBackfillBatchResult>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
}

const defaultDependencies: OrganizationTomlBackfillCliDependencies = {
	createDataSource: createOrganizationTomlBackfillDataSource,
	readAvailableBytes: async (path) => {
		const disk = await statfs(path, { bigint: true });
		return disk.bavail * disk.bsize;
	},
	runBatch: async (dataSource, batchSize, availableBytes) =>
		new OrganizationTomlEvidenceBackfill(batchSize).runBatch(dataSource, {
			availableBytes
		}),
	stderr: process.stderr,
	stdout: process.stdout
};

export function createOrganizationTomlBackfillDataSource(): DataSource {
	return new DataSource({
		...AppDataSource.options,
		migrationsRun: false
	});
}

export async function runOrganizationTomlBackfillCli(
	argv: readonly string[] = process.argv,
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: OrganizationTomlBackfillCliDependencies = defaultDependencies
): Promise<number> {
	try {
		return await executeOrganizationTomlBackfillCli(
			argv,
			environment,
			dependencies
		);
	} catch (error) {
		dependencies.stderr.write(
			`Organization TOML backfill unavailable: ${errorMessage(error)}\n`
		);
		return ORGANIZATION_TOML_BACKFILL_TEMPORARY_FAILURE_EXIT_CODE;
	}
}

async function executeOrganizationTomlBackfillCli(
	argv: readonly string[],
	environment: NodeJS.ProcessEnv,
	dependencies: OrganizationTomlBackfillCliDependencies
): Promise<number> {
	const batchSize = parseBatchSize(argv[2]);
	const diskPath = environment.ORGANIZATION_TOML_BACKFILL_DISK_PATH ?? '/';
	const availableBytes = await dependencies.readAvailableBytes(diskPath);
	const dataSource = dependencies.createDataSource();
	try {
		await dataSource.initialize();
		const result = await dependencies.runBatch(
			dataSource,
			batchSize,
			availableBytes
		);
		dependencies.stdout.write(`${JSON.stringify(result)}\n`);
		return result.pauseReason === null
			? 0
			: ORGANIZATION_TOML_BACKFILL_TEMPORARY_FAILURE_EXIT_CODE;
	} finally {
		if (dataSource.isInitialized) await dataSource.destroy();
	}
}

export function parseOrganizationTomlBackfillBatchSize(
	value: string | undefined
): number {
	return parseBatchSize(value);
}

function parseBatchSize(value: string | undefined): number {
	if (value === undefined) return DEFAULT_BATCH_SIZE;
	if (!/^[1-9][0-9]*$/.test(value)) {
		throw new Error(
			'TOML backfill batch size must be an integer from 1 to 1000'
		);
	}
	const batchSize = Number(value);
	if (!Number.isSafeInteger(batchSize) || batchSize > 1_000) {
		throw new Error(
			'TOML backfill batch size must be an integer from 1 to 1000'
		);
	}
	return batchSize;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
