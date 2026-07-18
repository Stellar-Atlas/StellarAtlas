import { ScpOrganizationMapCache } from '../ScpOrganizationMapCache.js';
import { knownOrganizations } from './ScpOrganizationInventoryFixture.js';

describe('ScpOrganizationMapCache', () => {
	it('coalesces concurrent reads and refreshes after its bounded lifetime', async () => {
		let nowMs = 1_000;
		const inventory = knownOrganizations([
			['GA', 'org-a'],
			['GB', 'org-b']
		]);
		const cache = new ScpOrganizationMapCache(inventory, 100, () => nowMs);

		const [first, concurrent] = await Promise.all([cache.get(), cache.get()]);
		expect(first.isOk()).toBe(true);
		expect(concurrent.isOk()).toBe(true);
		if (first.isErr() || concurrent.isErr()) return;
		expect([...first.value]).toEqual([
			['GA', 'org-a'],
			['GB', 'org-b']
		]);
		expect(concurrent.value).toBe(first.value);
		expect(inventory.executeAll).toHaveBeenCalledTimes(1);

		nowMs = 1_099;
		await cache.get();
		expect(inventory.executeAll).toHaveBeenCalledTimes(1);

		nowMs = 1_100;
		await cache.get();
		expect(inventory.executeAll).toHaveBeenCalledTimes(2);
	});
});
