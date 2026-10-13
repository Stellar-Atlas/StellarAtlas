import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';

const successTtlMs = 24 * 60 * 60 * 1000;
const failureTtlMs = 60 * 60 * 1000;

interface DomainRecord {
	readonly issuer: string;
	readonly homeDomain: string | null;
	readonly fetchedAt: string | null;
	readonly lastAttemptAt: string;
	readonly error: boolean;
}

export class IssuerHomeDomainCache {
	private readonly memory = new Map<string, DomainRecord>();
	private readonly inflight = new Map<string, Promise<string | null>>();
	private bulkSnapshot: { readonly at: number; readonly domains: ReadonlyMap<string, string | null> } | undefined;
	private bulkInflight: Promise<ReadonlyMap<string, string | null>> | undefined;

	public constructor(
		private readonly root: string,
		private readonly networkPassphrase: string,
		private readonly resolver: (issuer: string) => Promise<string | null>,
		private readonly schedule: <T>(task: () => Promise<T>) => Promise<T>,
		private readonly now: () => number
	) {}

	public async getCached(issuer: string): Promise<string | null> {
		return (await this.read(issuer))?.homeDomain ?? null;
	}

	public async getCachedAll(): Promise<ReadonlyMap<string, string | null>> {
		let domains = this.bulkSnapshot && this.now() - this.bulkSnapshot.at < 60_000
			? this.bulkSnapshot.domains
			: undefined;
		if (!domains) {
			if (!this.bulkInflight) this.bulkInflight = this.loadBulkSnapshot();
			const active = this.bulkInflight;
			try {
				domains = await active;
			} finally {
				if (this.bulkInflight === active) this.bulkInflight = undefined;
			}
		}
		const merged = new Map(domains);
		for (const [key, record] of this.memory) {
			if (StrKey.isValidEd25519PublicKey(record.issuer) && this.key(record.issuer) === key)
				merged.set(record.issuer, record.homeDomain);
		}
		return merged;
	}

	private async loadBulkSnapshot(): Promise<ReadonlyMap<string, string | null>> {
		const directory = join(this.root, 'issuer-domains');
		let entries: Dirent[] = [];
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		const files = entries.filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name));
		const domains = new Map<string, string | null>();
		let next = 0;
		const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
			while (next < files.length) {
				const file = files[next++]!;
				const key = file.name.slice(0, 64);
				try {
					const info = await readFile(join(directory, file.name));
					if (info.byteLength > 16 * 1024) continue;
					const record = this.parseRecord(JSON.parse(info.toString('utf8')), undefined, key);
					if (record) domains.set(record.issuer, record.homeDomain);
				} catch {}
			}
		});
		await Promise.all(workers);
		this.bulkSnapshot = { at: this.now(), domains };
		return domains;
	}

	public async get(issuer: string): Promise<string | null> {
		const record = await this.read(issuer);
		if (!record) {
			void this.resolve(issuer).catch(() => undefined);
			return null;
		}
		if (this.isStale(record)) void this.resolve(issuer).catch(() => undefined);
		return record.homeDomain;
	}
	public async isFreshMissing(issuer: string): Promise<boolean> {
		const record = await this.read(issuer);
		return (
			record !== null && record.homeDomain === null && !this.isStale(record)
		);
	}

	public async ensure(issuer: string): Promise<string | null> {
		const record = await this.read(issuer);
		if (record && !this.isStale(record)) return record.homeDomain;
		return this.resolve(issuer);
	}

	private async resolve(issuer: string): Promise<string | null> {
		const key = this.key(issuer);
		const active = this.inflight.get(key);
		if (active) return active;
		const work = this.schedule(async () => {
			const previous = await this.read(issuer);
			if (previous && !this.isStale(previous)) return previous.homeDomain;
			const attemptedAt = new Date(this.now()).toISOString();
			try {
				const homeDomain = await this.resolver(issuer);
				const record: DomainRecord = {
					issuer,
					homeDomain: homeDomain ?? previous?.homeDomain ?? null,
					fetchedAt: homeDomain
						? attemptedAt
						: (previous?.fetchedAt ?? attemptedAt),
					lastAttemptAt: attemptedAt,
					error: false
				};
				await this.write(issuer, record);
				return record.homeDomain;
			} catch {
				const record: DomainRecord = {
					issuer,
					homeDomain: previous?.homeDomain ?? null,
					fetchedAt: previous?.fetchedAt ?? null,
					lastAttemptAt: attemptedAt,
					error: true
				};
				await this.write(issuer, record);
				return record.homeDomain;
			}
		});
		this.inflight.set(key, work);
		try {
			return await work;
		} finally {
			this.inflight.delete(key);
		}
	}

	private parseRecord(value: unknown, issuer?: string, expectedKey?: string): DomainRecord | null {
		if (
			!isRecord(value) ||
			typeof value.issuer !== 'string' ||
			!StrKey.isValidEd25519PublicKey(value.issuer) ||
			(issuer !== undefined && value.issuer !== issuer) ||
			(expectedKey !== undefined && this.key(value.issuer) !== expectedKey) ||
			!(typeof value.homeDomain === 'string' || value.homeDomain === null) ||
			typeof value.lastAttemptAt !== 'string' ||
			typeof value.error !== 'boolean'
		) return null;
		return {
			issuer: value.issuer,
			homeDomain: value.homeDomain,
			fetchedAt: typeof value.fetchedAt === 'string' ? value.fetchedAt : null,
			lastAttemptAt: value.lastAttemptAt,
			error: value.error
		};
	}

	private async read(issuer: string): Promise<DomainRecord | null> {
		const key = this.key(issuer);
		const cached = this.memory.get(key);
		if (cached) return cached;
		try {
			const parsed: unknown = JSON.parse(
				await readFile(this.path(issuer), 'utf8')
			);
			const record = this.parseRecord(parsed, issuer, key);
			if (!record) return null;
			this.memory.set(key, record);
			return record;
		} catch {
			return null;
		}
	}

	private async write(issuer: string, record: DomainRecord): Promise<void> {
		const file = this.path(issuer);
		await mkdir(join(this.root, 'issuer-domains'), { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
		await rename(temporary, file);
		this.memory.set(this.key(issuer), record);
	}

	private isStale(record: DomainRecord): boolean {
		const timestamp = Date.parse(record.lastAttemptAt);
		const maxAge = record.error ? failureTtlMs : successTtlMs;
		return !Number.isFinite(timestamp) || this.now() - timestamp >= maxAge;
	}

	private key(issuer: string): string {
		return createHash('sha256')
			.update(`${this.networkPassphrase}\n${issuer}`)
			.digest('hex');
	}

	private path(issuer: string): string {
		return join(this.root, 'issuer-domains', `${this.key(issuer)}.json`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
