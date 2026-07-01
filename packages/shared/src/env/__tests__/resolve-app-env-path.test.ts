import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAppEnvPath } from '../resolve-app-env-path.js';

describe('resolveAppEnvPath', () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = mkdtempSync(resolve(tmpdir(), 'stellaratlas-env-'));
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	it('finds the app env path from a compiled module URL', () => {
		const modulePath = resolve(
			tempRoot,
			'apps/backend/lib/core/config/Config.js'
		);
		const envPath = resolve(tempRoot, 'apps/backend/.env');
		mkdirSync(resolve(tempRoot, 'apps/backend/lib/core/config'), {
			recursive: true
		});
		writeFileSync(envPath, '');

		expect(resolveAppEnvPath(pathToFileURL(modulePath).href, 'backend')).toBe(
			envPath
		);
	});

	it('finds the app env path from a source module URL', () => {
		const modulePath = resolve(
			tempRoot,
			'apps/history-scanner/src/infrastructure/config/Config.ts'
		);
		const envPath = resolve(tempRoot, 'apps/history-scanner/.env');
		mkdirSync(resolve(tempRoot, 'apps/history-scanner/src/infrastructure/config'), {
			recursive: true
		});
		writeFileSync(envPath, '');

		expect(
			resolveAppEnvPath(pathToFileURL(modulePath).href, 'history-scanner')
		).toBe(envPath);
	});

	it('falls back to the cwd app env path when the module is outside the app', () => {
		const previousCwd = process.cwd();
		const envPath = resolve(tempRoot, 'apps/backend/.env');
		mkdirSync(resolve(tempRoot, 'apps/backend'), { recursive: true });
		writeFileSync(envPath, '');

		try {
			process.chdir(tempRoot);
			expect(
				resolveAppEnvPath(
					pathToFileURL(resolve(tempRoot, 'packages/shared/lib/index.js')).href,
					'backend'
				)
			).toBe(envPath);
		} finally {
			process.chdir(previousCwd);
		}
	});
});
