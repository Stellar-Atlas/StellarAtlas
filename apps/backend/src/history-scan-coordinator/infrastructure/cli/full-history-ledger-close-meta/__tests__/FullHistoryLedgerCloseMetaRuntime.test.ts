import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFullHistoryLedgerCloseMetaServiceConfig } from '../FullHistoryLedgerCloseMetaServiceConfig.js';
import {
	ensureFullHistoryLedgerCloseMetaRuntime,
	removeStaleFullHistoryLedgerCloseMetaArtifacts,
	resetOwnedFullHistoryLedgerCloseMetaArtifacts
} from '../FullHistoryLedgerCloseMetaRuntime.js';

describe('FullHistoryLedgerCloseMetaRuntime', () => {
	it('uses private shared memory and removes only stale owned artifacts', async () => {
		const root = await mkdtemp('/dev/shm/stellaratlas-lcm-runtime-test-');
		try {
			const config = parseFullHistoryLedgerCloseMetaServiceConfig({
				FULL_HISTORY_BULK_ROOT: root,
				FULL_HISTORY_LEDGER_CLOSE_META_ENABLED: 'true',
				FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE: process.execPath,
				FULL_HISTORY_LEDGER_CLOSE_META_PROCESS_TIMEOUT_MS: '60000',
				FULL_HISTORY_LEDGER_CLOSE_META_TEMP_ROOT: join(root, 'transient'),
				FULL_HISTORY_LEDGER_CLOSE_META_TYPED_ROOT: join(root, 'typed'),
				FULL_HISTORY_NETWORK_PASSPHRASE:
					'Public Global Stellar Network ; September 2015'
			});
			await ensureFullHistoryLedgerCloseMetaRuntime(config);

			const staleTransient = join(
				config.temporaryInputRoot,
				'ledger-close-meta-stale'
			);
			const currentTransient = join(
				config.temporaryInputRoot,
				'ledger-close-meta-current'
			);
			const unrelated = join(config.temporaryInputRoot, 'unrelated');
			await Promise.all([
				mkdir(staleTransient),
				mkdir(currentTransient),
				mkdir(unrelated)
			]);
			await utimes(staleTransient, 0, 0);

			const publicationRoot = join(
				config.typedOutputRoot,
				'a'.repeat(64),
				'ledger-close-meta'
			);
			const staleStage = join(publicationRoot, '.3-4.tmp-stale');
			const published = join(publicationRoot, '3-4');
			await mkdir(staleStage, { recursive: true });
			await mkdir(published);
			await utimes(staleStage, 0, 0);

			await removeStaleFullHistoryLedgerCloseMetaArtifacts(config, 120_000);

			await expect(access(staleTransient)).rejects.toMatchObject({
				code: 'ENOENT'
			});
			await expect(access(staleStage)).rejects.toMatchObject({
				code: 'ENOENT'
			});
			await expect(
				access(currentTransient, constants.F_OK)
			).resolves.toBeUndefined();
			await expect(access(unrelated, constants.F_OK)).resolves.toBeUndefined();
			await expect(access(published, constants.F_OK)).resolves.toBeUndefined();
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it('removes every owned orphan during exclusive-leader startup', async () => {
		const root = await mkdtemp('/dev/shm/stellaratlas-lcm-reset-test-');
		try {
			const config = parseFullHistoryLedgerCloseMetaServiceConfig({
				FULL_HISTORY_BULK_ROOT: root,
				FULL_HISTORY_LEDGER_CLOSE_META_ENABLED: 'true',
				FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE: process.execPath,
				FULL_HISTORY_LEDGER_CLOSE_META_TEMP_ROOT: join(root, 'transient'),
				FULL_HISTORY_LEDGER_CLOSE_META_TYPED_ROOT: join(root, 'typed'),
				FULL_HISTORY_NETWORK_PASSPHRASE:
					'Public Global Stellar Network ; September 2015'
			});
			await ensureFullHistoryLedgerCloseMetaRuntime(config);
			const transient = join(
				config.temporaryInputRoot,
				'ledger-close-meta-recent'
			);
			const publicationRoot = join(
				config.typedOutputRoot,
				'b'.repeat(64),
				'ledger-close-meta'
			);
			const staging = join(publicationRoot, '.64-127.tmp-recent');
			const published = join(publicationRoot, '64-127');
			await mkdir(transient);
			await mkdir(staging, { recursive: true });
			await mkdir(published);

			await resetOwnedFullHistoryLedgerCloseMetaArtifacts(config);

			await expect(access(transient)).rejects.toMatchObject({ code: 'ENOENT' });
			await expect(access(staging)).rejects.toMatchObject({ code: 'ENOENT' });
			await expect(access(published)).resolves.toBeUndefined();
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
