import { constants, lstatSync, readFileSync, type BigIntStats } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { posix } from 'node:path';

const keys = ['version', 'bootId', 'invocationId', 'pid', 'startTicks', 'minimumLedger', 'maximumWriteBytes'] as const;

export function parseCurrentPublisherReadyPath(raw: string | undefined): string {
	if (raw === undefined || !/^\/run\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+$/u.test(raw) ||
		posix.normalize(raw) !== raw || raw.length > 512) {
		throw new Error('Standing current capture requires a publisher readiness file under /run');
	}
	return raw;
}

export function currentPublisherReadyIdentity(
	value: unknown, bootId: string, minimumLedger: number
): { readonly pid: number; readonly startTicks: string } | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
		row.version !== 1 || row.bootId !== bootId || row.minimumLedger !== minimumLedger ||
		typeof row.invocationId !== 'string' || !/^[0-9a-f]{32}$/u.test(row.invocationId) ||
		typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid < 2 || row.pid > 0x7fff_ffff ||
		typeof row.startTicks !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(row.startTicks) ||
		typeof row.maximumWriteBytes !== 'string' || !/^[1-9][0-9]{0,10}$/u.test(row.maximumWriteBytes)) {
		return null;
	}
	const max = BigInt(row.maximumWriteBytes);
	if (max < 1n << 30n || max > 32n << 30n) return null;
	return { pid: row.pid, startTicks: row.startTicks };
}

export async function assertCurrentPublisherReady(
	path: string, bootId: string, minimumLedger: number, signal: AbortSignal
): Promise<() => void> {
	const refused = () => new Error('Waiting for the bounded current publisher in the same server boot');
	try {
		signal.throwIfAborted();
		if (await realpath(path) !== path) throw refused();
		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		let value: unknown;
		let opened: BigIntStats;
		try {
			opened = await file.stat({ bigint: true });
			if (!opened.isFile() || (opened.mode & 0o022n) !== 0n || opened.size <= 0n || opened.size > 4_096n) throw refused();
			const buffer = Buffer.alloc(4_097);
			const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
			if (BigInt(bytesRead) !== opened.size) throw refused();
			value = JSON.parse(buffer.toString('utf8', 0, bytesRead)) as unknown;
		} finally {
			await file.close();
		}
		const ready = currentPublisherReadyIdentity(value, bootId, minimumLedger);
		if (ready === null) throw refused();
		const base = `/proc/${ready.pid}`;
		const cgroup = await readFile(base + '/cgroup', { encoding: 'utf8', signal });
		if (!/^0::\/(?:[^\n/]+\/)*stellaratlas-hubble-etl\.service$/mu.test(cgroup)) throw refused();
		const stat = await readFile(base + '/stat', { encoding: 'utf8', signal });
		if (!matchesRunningProcess(stat, ready)) throw refused();
		const named = await lstat(path, { bigint: true });
		if (!matchesMarker(opened, named)) throw refused();
		signal.throwIfAborted();
		return () => {
			signal.throwIfAborted();
			try {
				if (!matchesMarker(opened, lstatSync(path, { bigint: true })) ||
					readFileSync(base + '/cgroup', 'utf8') !== cgroup ||
					!matchesRunningProcess(readFileSync(base + '/stat', 'utf8'), ready)) throw refused();
			} catch {
				throw refused();
			}
		};
	} catch {
		signal.throwIfAborted();
		throw refused();
	}
}

function matchesMarker(opened: BigIntStats, named: BigIntStats): boolean {
	return named.isFile() && named.dev === opened.dev && named.ino === opened.ino &&
		named.size === opened.size && named.ctimeNs === opened.ctimeNs && named.mtimeNs === opened.mtimeNs;
}

function matchesRunningProcess(stat: string, ready: { readonly pid: number; readonly startTicks: string }): boolean {
	const lastParen = stat.lastIndexOf(')');
	if (lastParen < 0 || !stat.startsWith(`${ready.pid} (`)) return false;
	const [state, ...fields] = stat.slice(lastParen + 2).split(' ');
	return state !== 'Z' && state !== 'X' && state !== 'x' && fields[18] === ready.startTicks;
}
