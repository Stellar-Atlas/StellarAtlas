import { hackathonTags } from '../explorer-hackathons';

const entry = (overrides: Record<string, unknown> = {}) => ({
	slug: 'hackmeridian-2026',
	name: 'HackMeridian 2026',
	network: 'testnet',
	award: 'first',
	track: null,
	evidence: 'verified',
	...overrides
});

const labels = (value: unknown) =>
	hackathonTags(value).map((tags) => tags.map((tag) => tag.label));

describe('hackathonTags', () => {
	it('should badge the event with its award, the network and the evidence', () => {
		expect(labels([entry()])).toEqual([
			['HackMeridian 2026 · 1st place', 'testnet', 'on-chain verified']
		]);
	});

	it('should add a track badge only when one is given', () => {
		expect(labels([entry({ track: 'scale' })])).toEqual([
			['HackMeridian 2026 · 1st place', 'Scale', 'testnet', 'on-chain verified']
		]);
	});

	it('should say code only when there is no on-chain proof, and omit a missing award', () => {
		expect(labels([entry({ award: null, evidence: 'likely' })])).toEqual([
			['HackMeridian 2026', 'testnet', 'code only']
		]);
	});

	it('should label a runner-up', () => {
		expect(labels([entry({ award: 'runner-up' })])[0]?.[0]).toBe(
			'HackMeridian 2026 · Runner-up'
		);
	});

	it('should tone a win and verified evidence as good, and code only as a warning', () => {
		const [event, , proof] = hackathonTags([entry()]).flat();
		const [, , unproven] = hackathonTags([
			entry({ evidence: 'likely' })
		]).flat();

		expect([event?.tone, proof?.tone, unproven?.tone]).toEqual([
			'good',
			'good',
			'warning'
		]);
	});

	it('should list every hackathon', () => {
		expect(
			hackathonTags([
				entry(),
				entry({ name: 'HackMeridian 2027', award: null })
			])
		).toHaveLength(2);
	});

	it.each([undefined, null, 'text', 5, {}, [null, 1, {}, { name: 1 }]])(
		'should ignore a malformed value %j',
		(value) => {
			expect(hackathonTags(value)).toEqual([]);
		}
	);

	it('should ignore an award or track it does not know', () => {
		expect(labels([entry({ award: 'gold', track: 'x' })])).toEqual([
			['HackMeridian 2026', 'testnet', 'on-chain verified']
		]);
	});
});
