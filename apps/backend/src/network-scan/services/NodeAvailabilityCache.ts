import type { NodeMeasurementAverage } from '../domain/node/NodeMeasurementAverage.js';

export interface NodeAvailabilityAverages {
	day: readonly NodeMeasurementAverage[];
	month: readonly NodeMeasurementAverage[];
}

/** Small process-local cache; exact historical and completed-scan times differ. */
export class NodeAvailabilityCache {
	private readonly values = new Map<
		string,
		{ expires: number; value: NodeAvailabilityAverages }
	>();
	private readonly pending = new Map<
		string,
		Promise<NodeAvailabilityAverages>
	>();

	async get(
		time: Date,
		load: () => Promise<NodeAvailabilityAverages>
	): Promise<NodeAvailabilityAverages> {
		const key = time.toISOString();
		const cached = this.values.get(key);
		if (cached !== undefined && cached.expires > Date.now()) {
			this.values.delete(key);
			this.values.set(key, cached);
			return cached.value;
		}
		this.values.delete(key);
		const existing = this.pending.get(key);
		if (existing !== undefined) return existing;
		if (this.pending.size >= 4)
			throw new Error('Node availability refresh capacity exceeded');
		const pending = Promise.resolve()
			.then(load)
			.then((value) => {
				this.values.set(key, { expires: Date.now() + 10 * 60_000, value });
				while (this.values.size > 10) {
					const oldest = this.values.keys().next().value;
					if (oldest !== undefined) this.values.delete(oldest);
				}
				return value;
			})
			.finally(() => {
				this.pending.delete(key);
			});
		this.pending.set(key, pending);
		return pending;
	}
}
