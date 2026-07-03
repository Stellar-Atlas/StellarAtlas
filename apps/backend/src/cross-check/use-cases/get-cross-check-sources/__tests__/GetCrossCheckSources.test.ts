import { GetCrossCheckSources } from '../GetCrossCheckSources.js';

describe('GetCrossCheckSources', () => {
	it('should return the configured cross-check source catalog without probing', () => {
		const result = new GetCrossCheckSources().execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(Date.parse(result.value.generatedAt)).not.toBeNaN();
		expect(result.value.probe).toBe('not_run');
		expect(result.value.sources).toHaveLength(2);
		expect(result.value.sources.map((source) => source.id)).toEqual([
			'stellaratlas-api',
			'withobsrvr-radar'
		]);
		expect(
			result.value.sources.every((source) => source.probe === 'not_run')
		).toBe(true);
		expect(result.value.sources[0].scopes).toEqual([
			'validators',
			'organizations',
			'archives'
		]);
	});
});
