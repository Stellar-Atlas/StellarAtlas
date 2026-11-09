import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync
} from 'node:fs';
import { dirname } from 'node:path';

/** Only call with a deployment-owned, fixed credential path. */
export function readProtectedVerificationCredential(
	path: string,
	maxBytes: number
): string {
	for (const parent of ['/', '/etc', '/etc/stellaratlas', dirname(path)]) {
		const stat = lstatSync(parent);
		if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)
			throw new Error('Unprotected verification credential directory');
	}
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.size < 1 ||
			stat.size > maxBytes ||
			(stat.mode & 0o077) !== 0 ||
			(stat.uid !== 0 && stat.uid !== process.getuid?.())
		)
			throw new Error('Unprotected verification credential');
		const bytes = Buffer.alloc(maxBytes + 1);
		const count = readSync(fd, bytes, 0, bytes.length, 0);
		if (count !== stat.size || fstatSync(fd).size !== stat.size)
			throw new Error('Verification credential changed during read');
		return bytes.subarray(0, count).toString('utf8').trim();
	} finally {
		closeSync(fd);
	}
}
