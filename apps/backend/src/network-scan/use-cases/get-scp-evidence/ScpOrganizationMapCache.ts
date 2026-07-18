import { err, ok, type Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { GetKnownOrganizations } from '../get-known-organizations/GetKnownOrganizations.js';

const defaultCacheTtlMs = 30_000;

interface CachedOrganizationMap {
	expiresAtMs: number;
	value: ReadonlyMap<string, string>;
}

export class ScpOrganizationMapCache {
	private cached: CachedOrganizationMap | undefined;
	private refresh:
		Promise<Result<ReadonlyMap<string, string>, Error>> | undefined;

	constructor(
		private readonly getKnownOrganizations: GetKnownOrganizations,
		private readonly cacheTtlMs = defaultCacheTtlMs,
		private readonly now: () => number = Date.now
	) {}

	get(): Promise<Result<ReadonlyMap<string, string>, Error>> {
		const nowMs = this.now();
		if (this.cached !== undefined && nowMs < this.cached.expiresAtMs) {
			return Promise.resolve(ok(this.cached.value));
		}

		this.refresh ??= this.load(nowMs).finally(() => {
			this.refresh = undefined;
		});
		return this.refresh;
	}

	private async load(
		nowMs: number
	): Promise<Result<ReadonlyMap<string, string>, Error>> {
		try {
			const inventory = await this.getKnownOrganizations.executeAll();
			if (inventory.isErr()) return err(inventory.error);

			const assignments = new Map<string, string>();
			const organizations = inventory.value.organizations.toSorted(
				(left, right) =>
					Number(right.current) - Number(left.current) ||
					left.organization.id.localeCompare(right.organization.id)
			);
			for (const { organization } of organizations) {
				for (const validator of organization.validators) {
					if (!assignments.has(validator)) {
						assignments.set(validator, organization.id);
					}
				}
			}

			this.cached = {
				expiresAtMs: nowMs + this.cacheTtlMs,
				value: assignments
			};
			return ok(assignments);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}
