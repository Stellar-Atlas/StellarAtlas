import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const activeOwnerFileName = '.active-owner';

export async function claimFullHistoryLedgerCloseMetaTransientDirectory(
	directory: string
): Promise<void> {
	await writeFile(join(directory, activeOwnerFileName), `${process.pid}\n`, {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600
	});
}

export async function isFullHistoryLedgerCloseMetaTransientDirectoryActive(
	directory: string
): Promise<boolean> {
	try {
		const owner = await readFile(join(directory, activeOwnerFileName), 'utf8');
		return owner.trim() === String(process.pid);
	} catch (error: unknown) {
		if (isMissing(error)) return false;
		throw error;
	}
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ENOENT'
	);
}
