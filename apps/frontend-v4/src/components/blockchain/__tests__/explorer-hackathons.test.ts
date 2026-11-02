import { hackathonTags } from '../explorer-hackathons';

const entry = (overrides: Record<string, unknown> = {}) => ({
	slug: 'hackmeridian-2026',
	name: 'HackMeridian 2026',
	network: 'testnet',
	award: 'first',
	track: null,
	...overrides
});

const labels = (value: unknown) => hackathonTags(value).map((tag) => tag.label);

describe('hackathonTags', () => {
	it('should make one badge of the event and its award', () => {
		expect(labels([entry()])).toEqual(['HackMeridian 2026 · 1st place']);
	});

	it('should label a runner-up', () => {
		expect(labels([entry({ award: 'runner-up' })])).toEqual([
			'HackMeridian 2026 · Runner-up'
		]);
	});

	it('should show the event alone when there is no award', () => {
		expect(labels([entry({ award: null })])).toEqual(['HackMeridian 2026']);
	});

	it('should tone an award as good and a plain entry as neutral', () => {
		expect(
			hackathonTags([entry(), entry({ award: null })]).map((t) => t.tone)
		).toEqual(['good', 'neutral']);
	});

	it('should name the network in the tooltip', () => {
		expect(hackathonTags([entry()])[0]?.title).toBe(
			'HackMeridian 2026 ran on testnet'
		);
	});

	it('should list every hackathon', () => {
		expect(
			labels([entry(), entry({ name: 'HackMeridian 2027', award: null })])
		).toHaveLength(2);
	});

	it.each([undefined, null, 'text', 5, {}, [null, 1, {}, { name: 1 }]])(
		'should ignore a malformed value %j',
		(value) => {
			expect(hackathonTags(value)).toEqual([]);
		}
	);

	it('should ignore an award it does not know', () => {
		expect(labels([entry({ award: 'gold' })])).toEqual(['HackMeridian 2026']);
	});
});
