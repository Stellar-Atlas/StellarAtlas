import { hackathonLabels } from '../explorer-hackathons';

const entry = (overrides: Record<string, unknown> = {}) => ({
	slug: 'hackmeridian-2026',
	name: 'HackMeridian 2026',
	network: 'testnet',
	award: 'first',
	track: null,
	evidence: 'verified',
	...overrides
});

describe('hackathonLabels', () => {
	it('should say the event, its network, the award and the evidence', () => {
		expect(hackathonLabels([entry()])).toEqual([
			'HackMeridian 2026 (testnet) · 1st place · on-chain verified'
		]);
	});

	it('should include a track only when one is given', () => {
		expect(hackathonLabels([entry({ track: 'scale' })])).toEqual([
			'HackMeridian 2026 (testnet) · 1st place · Scale · on-chain verified'
		]);
	});

	it('should say code only when there is no on-chain proof, and omit a missing award', () => {
		expect(
			hackathonLabels([entry({ award: null, evidence: 'likely' })])
		).toEqual(['HackMeridian 2026 (testnet) · code only']);
	});

	it('should label a runner-up', () => {
		expect(hackathonLabels([entry({ award: 'runner-up' })])[0]).toContain(
			'Runner-up'
		);
	});

	it('should list every hackathon', () => {
		expect(
			hackathonLabels([
				entry(),
				entry({ name: 'HackMeridian 2027', award: null })
			])
		).toHaveLength(2);
	});

	it.each([undefined, null, 'text', 5, {}, [null, 1, {}, { name: 1 }]])(
		'should ignore a malformed value %j',
		(value) => {
			expect(hackathonLabels(value)).toEqual([]);
		}
	);

	it('should ignore an award or track it does not know', () => {
		expect(hackathonLabels([entry({ award: 'gold', track: 'x' })])).toEqual([
			'HackMeridian 2026 (testnet) · on-chain verified'
		]);
	});
});
