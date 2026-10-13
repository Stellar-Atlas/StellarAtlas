import {
	findCurrency,
	detectLogoExtension,
	unavailable,
	pending,
	emptyIssuer,
	organizationFromIssuerFields,
	isPersistedIssuer,
	isRecord,
	isCode,
	safeError,
	assertCacheSpace,
	isCacheSpaceError,
	removeExpiredLock,
	delay,
	issuerTomlUrl,
	type PersistedIssuer
} from './AssetMetadataValues.js';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIssuerToml } from './parseIssuerToml.js';
import { requestPublicHttps } from './safeHttp.js';
import { IssuerHomeDomainCache } from './IssuerHomeDomainCache.js';
import { CrossProcessSlots } from './CrossProcessSlots.js';
import type {
	AssetMetadata,
	AssetMetadataInput,
	AssetMetadataServiceOptions,
	CurrencyEntry,
	IssuerMetadata
} from './types.js';

const successTtlMs = 24 * 60 * 60 * 1000;
const issuerLockStaleMs = 90_000;
const failureTtlMs = 60 * 60 * 1000;
const tomlMaxBytes = 100 * 1024;
const logoMaxBytes = 2 * 1024 * 1024;
const publicLogoPath = '/v1/asset-logos';

export class AssetMetadataService {
	private readonly requestImpl: typeof requestPublicHttps;
	private readonly homeDomains: IssuerHomeDomainCache;
	private readonly now: () => number;
	private readonly slots: CrossProcessSlots;
	private readonly inflight = new Map<string, Promise<IssuerMetadata | null>>();
	private readonly logoInflight = new Map<string, Promise<string | null>>();
	private readonly issuerMemory = new Map<string, PersistedIssuer>();
	private readonly logoMemory = new Map<string, string>();
	private active = 0;
	private readonly queue: Array<() => void> = [];

	public constructor(private readonly options: AssetMetadataServiceOptions) {
		this.requestImpl = options.requestImpl ?? requestPublicHttps;
		this.now = options.now ?? Date.now;
		this.homeDomains = new IssuerHomeDomainCache(
			options.cacheRoot,
			options.networkPassphrase,
			options.resolveIssuerHomeDomain,
			(task) => this.withSlot(task),
			this.now
		);
		this.slots = new CrossProcessSlots(options.cacheRoot, 2, this.now);
	}

	public getCachedLogoDirectory(): string {
		return join(this.options.cacheRoot, 'logos');
	}

	public staticLogoUrl(filename: string): string {
		return `${publicLogoPath}/${filename}`;
	}

	public getCachedIssuerHomeDomains(): Promise<
		ReadonlyMap<string, string | null>
	> {
		return this.homeDomains.getCachedAll();
	}

	public async getAssetMetadata(
		input: AssetMetadataInput
	): Promise<AssetMetadata> {
		const { issuer, code, contractId } = input;
		if ((!issuer || !code) && !contractId) {
			return unavailable(input.id, null, 'Asset identity is incomplete');
		}
		if (!issuer)
			return unavailable(input.id, null, 'Issuer home domain is unavailable');
		const homeDomain = await this.homeDomains.get(issuer);
		if (!homeDomain) {
			if (await this.homeDomains.isFreshMissing(issuer))
				return unavailable(input.id, null, 'Issuer has no home domain');
			void this.homeDomains
				.ensure(issuer)
				.then((resolved) => {
					if (resolved)
						void this.enqueueIssuerRefresh(resolved).catch(() => undefined);
				})
				.catch(() => undefined);
			return pending(input.id, null, 'Issuer home domain lookup pending');
		}
		const cached = await this.readIssuer(homeDomain);
		const match = findCurrency(cached?.currencies ?? [], {
			code,
			issuer,
			contractId
		});
		if (cached && match) {
			const result = await this.mapAsset(input.id, homeDomain, cached, match);
			if (this.needsRefresh(cached))
				void this.enqueueIssuerRefresh(homeDomain).catch(() => undefined);
			return result;
		}
		if (cached && !this.needsRefresh(cached)) {
			return {
				...unavailable(
					input.id,
					homeDomain,
					cached.error ?? 'No exact matching currency was listed in issuer TOML'
				),
				tomlUrl: cached.tomlUrl,
				fetchedAt: cached.fetchedAt
			};
		}
		void this.enqueueIssuerRefresh(homeDomain).catch(() => undefined);
		return {
			...unavailable(input.id, homeDomain, cached?.error ?? null),
			status: 'pending',
			tomlUrl: issuerTomlUrl(homeDomain)
		};
	}

	public async ensureAssetMetadata(
		input: AssetMetadataInput
	): Promise<AssetMetadata> {
		if (!input.issuer) return this.getAssetMetadata(input);
		const homeDomain = await this.homeDomains.ensure(input.issuer);
		if (!homeDomain)
			return unavailable(input.id, null, 'Issuer home domain is unavailable');
		const data = await this.enqueueIssuerRefresh(homeDomain);
		const match = findCurrency(data?.currencies ?? [], input);
		if (match?.image) await this.enqueueLogo(match.image);
		return this.getAssetMetadata(input);
	}

	public async getIssuerMetadata(
		homeDomain: string
	): Promise<IssuerMetadata | null> {
		const resolved = /^G[A-Z2-7]{55}$/.test(homeDomain)
			? await this.homeDomains.get(homeDomain)
			: homeDomain;
		const data = resolved ? await this.readIssuer(resolved) : null;
		if (resolved && data && this.needsRefresh(data))
			void this.enqueueIssuerRefresh(resolved).catch(() => undefined);
		return data;
	}

	public async ensureIssuerMetadata(
		issuer: string
	): Promise<IssuerMetadata | null> {
		const homeDomain = await this.homeDomains.ensure(issuer);
		if (!homeDomain) return null;
		await this.enqueueIssuerRefresh(homeDomain);
		return this.readIssuer(homeDomain);
	}

	private async mapAsset(
		id: string,
		homeDomain: string,
		issuerData: PersistedIssuer,
		currency: CurrencyEntry
	): Promise<AssetMetadata> {
		const logoKey = currency.image ? this.logoKey(currency.image) : null;
		const logoFile =
			(logoKey ? issuerData.logoFiles[logoKey] : undefined) ??
			(logoKey ? await this.readLogoIndex(logoKey) : undefined);
		const retryAt = logoKey ? await this.readLogoFailure(logoKey) : 0;
		if (currency.image && logoKey && !logoFile && retryAt <= this.now()) {
			void this.enqueueLogo(currency.image).catch(() => undefined);
		}
		return {
			id,
			status: 'ready',
			name: currency.name ?? currency.fields.display_name ?? null,
			description: currency.description,
			homeDomain,
			tomlUrl: issuerData.tomlUrl,
			logoStatus: logoFile
				? 'ready'
				: currency.image
					? 'pending'
					: 'unavailable',
			logoUrl: logoFile ? this.staticLogoUrl(logoFile) : null,
			fields: currency.fields,
			organization: organizationFromIssuerFields(issuerData.fields),
			fetchedAt: issuerData.fetchedAt,
			error: issuerData.error
		};
	}

	private async enqueueIssuerRefresh(
		homeDomain: string
	): Promise<IssuerMetadata | null> {
		const key = this.issuerKey(homeDomain);
		const existing = this.inflight.get(key);
		if (existing) return existing;
		const work = this.withSlot(() => this.refreshIssuer(homeDomain));
		this.inflight.set(key, work);
		try {
			return await work;
		} finally {
			this.inflight.delete(key);
		}
	}

	private async refreshIssuer(
		homeDomain: string
	): Promise<IssuerMetadata | null> {
		const existing = await this.readIssuer(homeDomain);
		if (existing && !this.needsRefresh(existing)) return existing;
		const lockPath = `${this.issuerPath(homeDomain)}.lock`;
		await mkdir(join(this.options.cacheRoot, 'issuers'), { recursive: true });
		let lock;
		try {
			lock = await open(lockPath, 'wx');
		} catch {
			if (await removeExpiredLock(lockPath, this.now(), issuerLockStaleMs))
				return this.refreshIssuer(homeDomain);
			for (let attempt = 0; attempt < 20; attempt++) {
				await delay(250);
				const latest = await this.readIssuer(homeDomain);
				if (await removeExpiredLock(lockPath, this.now(), issuerLockStaleMs))
					return this.refreshIssuer(homeDomain);
				if (latest && !this.needsRefresh(latest)) return latest;
			}
			return existing;
		}
		let current = existing;
		try {
			current = await this.readIssuer(homeDomain);
			if (current && !this.needsRefresh(current)) return current;
			const headers: Record<string, string> = {};
			if (current?.etag) headers['if-none-match'] = current.etag;
			if (current?.lastModified)
				headers['if-modified-since'] = current.lastModified;
			await assertCacheSpace(this.options.cacheRoot, tomlMaxBytes);
			const response = await this.requestImpl(
				issuerTomlUrl(homeDomain),
				headers,
				tomlMaxBytes
			);
			const at = new Date(this.now()).toISOString();
			if (response.status === 304 && current) {
				const renewed = {
					...current,
					fetchedAt: at,
					error: null,
					lastAttemptAt: at
				};
				await this.writeIssuer(homeDomain, renewed);
				return renewed;
			}
			if (response.status !== 200)
				throw new Error(`Issuer TOML returned HTTP ${response.status}`);
			const parsed = parseIssuerToml(response.body.toString('utf8'));
			if (
				parsed.networkPassphrase &&
				parsed.networkPassphrase !== this.options.networkPassphrase
			) {
				throw new Error('Issuer TOML network passphrase does not match');
			}
			const fresh: PersistedIssuer = {
				homeDomain,
				tomlUrl: issuerTomlUrl(homeDomain),
				networkPassphrase: this.options.networkPassphrase,
				currencies: parsed.currencies,
				fields: parsed.fields,
				fetchedAt: at,
				etag: response.headers.etag ?? null,
				lastModified: response.headers['last-modified'] ?? null,
				error: null,
				lastAttemptAt: at,
				logoFiles: current?.logoFiles ?? {}
			};
			await this.writeIssuer(homeDomain, fresh);
			return fresh;
		} catch (error) {
			const at = new Date(this.now()).toISOString();
			const failure: PersistedIssuer = {
				...(current ??
					emptyIssuer(
						homeDomain,
						issuerTomlUrl(homeDomain),
						this.options.networkPassphrase,
						at
					)),
				error: safeError(error),
				lastAttemptAt: at
			};
			if (isCacheSpaceError(error)) return failure;
			await this.writeIssuer(homeDomain, failure);
			return failure;
		} finally {
			await lock?.close();
			await rm(lockPath, { force: true });
		}
	}

	private async enqueueLogo(rawUrl: string): Promise<string | null> {
		const key = this.logoKey(rawUrl);
		const saved = this.logoMemory.get(key) ?? (await this.readLogoIndex(key));
		if (saved) return saved;
		const retryAt = await this.readLogoFailure(key);
		if (retryAt > this.now()) return null;
		const existing = this.logoInflight.get(key);
		if (existing) return existing;
		const work = this.withSlot(() => this.cacheLogo(rawUrl, key));
		this.logoInflight.set(key, work);
		try {
			return await work;
		} finally {
			this.logoInflight.delete(key);
		}
	}

	private async cacheLogo(rawUrl: string, key: string): Promise<string | null> {
		try {
			await assertCacheSpace(this.options.cacheRoot, logoMaxBytes);
			const response = await this.requestImpl(rawUrl, {}, logoMaxBytes);
			if (response.status !== 200) {
				await this.writeLogoFailure(key);
				return null;
			}
			const extension = detectLogoExtension(response.body);
			if (!extension) {
				await this.writeLogoFailure(key);
				return null;
			}
			const digest = createHash('sha256').update(response.body).digest('hex');
			const filename = `${digest}.${extension}`;
			await assertCacheSpace(
				this.options.cacheRoot,
				response.body.byteLength +
					Buffer.byteLength(JSON.stringify({ filename }))
			);
			const directory = this.getCachedLogoDirectory();
			await mkdir(directory, { recursive: true });
			try {
				await writeFile(join(directory, filename), response.body, {
					flag: 'wx'
				});
			} catch (error) {
				if (!isCode(error, 'EEXIST')) throw error;
			}
			await writeFile(
				join(directory, `${key}.json`),
				JSON.stringify({ filename })
			);
			await rm(join(directory, `${key}.failed.json`), { force: true });
			this.logoMemory.set(key, filename);
			return filename;
		} catch (error) {
			if (!isCacheSpaceError(error)) await this.writeLogoFailure(key);
			return null;
		}
	}

	private async readLogoFailure(key: string): Promise<number> {
		try {
			const value: unknown = JSON.parse(
				await readFile(
					join(this.getCachedLogoDirectory(), `${key}.failed.json`),
					'utf8'
				)
			);
			return isRecord(value) && typeof value.retryAt === 'number'
				? value.retryAt
				: 0;
		} catch {
			return 0;
		}
	}

	private async writeLogoFailure(key: string): Promise<void> {
		try {
			const directory = this.getCachedLogoDirectory();
			await mkdir(directory, { recursive: true });
			const record = JSON.stringify({ retryAt: this.now() + failureTtlMs });
			await assertCacheSpace(this.options.cacheRoot, Buffer.byteLength(record));
			await writeFile(join(directory, `${key}.failed.json`), record, {
				mode: 0o600
			});
		} catch {
			// A failed logo must not invalidate issuer metadata.
		}
	}

	private async readLogoIndex(key: string): Promise<string | undefined> {
		try {
			const data: unknown = JSON.parse(
				await readFile(
					join(this.getCachedLogoDirectory(), `${key}.json`),
					'utf8'
				)
			);
			if (!isRecord(data) || typeof data.filename !== 'string')
				return undefined;
			if (!/^[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(data.filename))
				return undefined;
			this.logoMemory.set(key, data.filename);
			return data.filename;
		} catch {
			return undefined;
		}
	}

	private async readIssuer(
		homeDomain: string
	): Promise<PersistedIssuer | null> {
		const key = this.issuerKey(homeDomain);
		const memory = this.issuerMemory.get(key);
		if (memory) return memory;
		try {
			const value: unknown = JSON.parse(
				await readFile(this.issuerPath(homeDomain), 'utf8')
			);
			if (!isPersistedIssuer(value, homeDomain, this.options.networkPassphrase))
				return null;
			this.issuerMemory.set(key, value);
			return value;
		} catch {
			return null;
		}
	}

	private async writeIssuer(
		homeDomain: string,
		data: PersistedIssuer
	): Promise<void> {
		const path = this.issuerPath(homeDomain);
		await mkdir(join(this.options.cacheRoot, 'issuers'), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		const serialized = JSON.stringify(data);
		await assertCacheSpace(
			this.options.cacheRoot,
			Buffer.byteLength(serialized)
		);
		await writeFile(temporary, serialized, { mode: 0o600 });
		await rename(temporary, path);
		this.issuerMemory.set(this.issuerKey(homeDomain), data);
	}

	private needsRefresh(data: IssuerMetadata): boolean {
		const freshnessAt = data.lastAttemptAt ?? data.fetchedAt;
		const age = this.now() - Date.parse(freshnessAt);
		return age >= (data.error ? failureTtlMs : successTtlMs);
	}

	private issuerKey(homeDomain: string): string {
		return createHash('sha256')
			.update(`${this.options.networkPassphrase}\n${homeDomain.toLowerCase()}`)
			.digest('hex');
	}

	private issuerPath(homeDomain: string): string {
		return join(
			this.options.cacheRoot,
			'issuers',
			`${this.issuerKey(homeDomain)}.json`
		);
	}

	private logoKey(url: string): string {
		return createHash('sha256').update(url).digest('hex');
	}

	private async withSlot<T>(task: () => Promise<T>): Promise<T> {
		if (this.active >= 2) {
			if (this.queue.length >= 512)
				throw new Error('Asset metadata queue is full');
			await new Promise<void>((resolve) => this.queue.push(resolve));
		}
		this.active++;
		let release: (() => Promise<void>) | undefined;
		try {
			release = await this.slots.acquire();
			return await task();
		} finally {
			await release?.();
			this.active--;
			this.queue.shift()?.();
		}
	}
}
