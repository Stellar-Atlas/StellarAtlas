import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isGitOid } from '../../../status/infrastructure/directory/ExpertDirectoryRecord.js';
import {
	importLocalExpertDirectoryDelta,
	importLocalExpertDirectorySnapshot,
	type DirectoryGitRevision
} from '../../../status/infrastructure/directory/LocalExpertDirectoryGit.js';

type Manifest = {
	mode: 'snapshot' | 'refresh' | 'delta';
	approvedGitDir: string;
	to: DirectoryGitRevision;
	from?: DirectoryGitRevision;
	observedAt: string;
};

export function parseDirectoryImportManifest(value: unknown): Manifest {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('Invalid import manifest');
	const row = value as Record<string, unknown>;
	if (
		Object.keys(row).some(
			(key) =>
				!['mode', 'approvedGitDir', 'from', 'to', 'observedAt'].includes(key)
		) ||
		(row.mode !== 'snapshot' && row.mode !== 'refresh' && row.mode !== 'delta') ||
		typeof row.approvedGitDir !== 'string' ||
		typeof row.observedAt !== 'string' ||
		row.observedAt.length > 64 ||
		!Number.isFinite(Date.parse(row.observedAt))
	)
		throw new Error('Invalid import manifest');
	function revision(input: unknown): DirectoryGitRevision {
		if (typeof input !== 'object' || input === null || Array.isArray(input))
			throw new Error('Invalid pinned revision');
		const pin = input as Record<string, unknown>;
		if (
			Object.keys(pin).length !== 2 ||
			!isGitOid(pin.commit) ||
			!isGitOid(pin.tree)
		)
			throw new Error('Invalid pinned revision');
		return { commit: pin.commit, tree: pin.tree };
	}
	if (row.mode === 'snapshot' && row.from !== undefined)
		throw new Error('Initial snapshots have no prior revision');
	return {
		mode: row.mode,
		approvedGitDir: row.approvedGitDir,
		to: revision(row.to),
		...(row.mode !== 'snapshot' ? { from: revision(row.from) } : {}),
		observedAt: row.observedAt
	};
}

async function main(): Promise<void> {
	if (process.argv.length !== 3 || process.argv[2] !== '--apply')
		throw new Error(
			'Use import-account-directory --apply with an approved JSON manifest on stdin'
		);
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > 16 * 1024) throw new Error('Import manifest exceeds its limit');
		chunks.push(bytes);
	}
	const manifest = parseDirectoryImportManifest(
		JSON.parse(Buffer.concat(chunks).toString('utf8'))
	);
	// This operator process never admits automatic schema changes or extensions.
	process.env.DATABASE_MIGRATIONS_RUN = 'false';
	process.env.API_BACKGROUND_TASKS_ENABLED = 'false';
	const { AppDataSource } = await import('../database/AppDataSource.js');
	const { TypeOrmExpertDirectoryStore } =
		await import('../../../status/infrastructure/directory/TypeOrmExpertDirectoryStore.js');
	AppDataSource.setOptions({
		migrationsRun: false,
		synchronize: false,
		installExtensions: false,
		poolSize: 2
	});
	const store = new TypeOrmExpertDirectoryStore(AppDataSource);
	const initialize = async () => {
		if (!AppDataSource.isInitialized) await AppDataSource.initialize();
	};
	const interruption = new AbortController();
	const interrupt = () => interruption.abort(new Error('Directory import interrupted'));
	process.once('SIGINT', interrupt);
	process.once('SIGTERM', interrupt);
	try {
		const input = {
			...manifest,
			signal: AbortSignal.any([
				interruption.signal,
				AbortSignal.timeout(manifest.mode === 'delta' ? 120_000 : 60 * 60_000)
			])
		};
		const result =
			manifest.mode !== 'delta'
				? await importLocalExpertDirectorySnapshot(input, {
						publishSnapshot: async (...args) => {
							await initialize();
							return store.publishSnapshot(...args);
						}
					})
				: await importLocalExpertDirectoryDelta(
						{ ...input, from: manifest.from! },
						{
							transaction: async (work) => {
								await initialize();
								return store.transaction(work);
							}
						}
					);
		console.log(JSON.stringify(result));
	} finally {
		process.off('SIGINT', interrupt);
		process.off('SIGTERM', interrupt);
		if (AppDataSource.isInitialized) await AppDataSource.destroy();
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	void main().catch(() => {
		console.error(
			'Directory import failed. No successful checkpoint is claimed.'
		);
		process.exitCode = 1;
	});
