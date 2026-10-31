import { hackathonsOf, readHackathons } from '../HackathonParticipation.js';

const valid = {
	events: {
		'demo-2026': { name: 'Demo 2026', network: 'testnet' }
	},
	repositories: {
		'team/app': [
			{ event: 'demo-2026', award: 'first', track: null, evidence: 'verified' }
		]
	}
};

describe('hackathonsOf', () => {
	it('should find a repository without regard to case', () => {
		expect(hackathonsOf('Ethan-R13N/Nest')).toEqual([
			{
				slug: 'hackmeridian-2026',
				name: 'HackMeridian 2026',
				network: 'testnet',
				award: 'first',
				track: null,
				evidence: 'verified'
			}
		]);
	});

	it('should say which track a team declared', () => {
		expect(hackathonsOf('troqpay/private-yield')[0]).toMatchObject({
			award: 'runner-up',
			track: 'scale'
		});
	});

	it('should return nothing for a repository in no hackathon, or none at all', () => {
		expect(hackathonsOf('stellar/rs-soroban-sdk')).toEqual([]);
		expect(hackathonsOf(null)).toEqual([]);
		expect(hackathonsOf('')).toEqual([]);
	});

	it('should not answer for inherited object keys', () => {
		expect(hackathonsOf('constructor')).toEqual([]);
		expect(hackathonsOf('__proto__')).toEqual([]);
	});
});

describe('readHackathons', () => {
	it('should read a repository with its event', () => {
		expect(readHackathons(valid).get('team/app')).toEqual([
			{
				slug: 'demo-2026',
				name: 'Demo 2026',
				network: 'testnet',
				award: 'first',
				track: null,
				evidence: 'verified'
			}
		]);
	});

	it.each([
		[
			'an upper-case repository',
			{ ...valid, repositories: { 'Team/App': valid.repositories['team/app'] } }
		],
		[
			'a repository without a list',
			{ ...valid, repositories: { 'team/app': {} } }
		],
		[
			'an unknown event',
			{
				...valid,
				repositories: {
					'team/app': [{ ...valid.repositories['team/app'][0], event: 'x' }]
				}
			}
		],
		[
			'an unknown award',
			{
				...valid,
				repositories: {
					'team/app': [{ ...valid.repositories['team/app'][0], award: 'gold' }]
				}
			}
		],
		[
			'an unknown track',
			{
				...valid,
				repositories: {
					'team/app': [{ ...valid.repositories['team/app'][0], track: 'x' }]
				}
			}
		],
		[
			'an unknown evidence level',
			{
				...valid,
				repositories: {
					'team/app': [
						{ ...valid.repositories['team/app'][0], evidence: 'sure' }
					]
				}
			}
		],
		[
			'an event without a name',
			{ ...valid, events: { 'demo-2026': { network: 'testnet' } } }
		]
	])(
		'should refuse %s, so bad data stops the server at startup',
		(_name, data) => {
			expect(() => readHackathons(data)).toThrow(/hackathons\.json/);
		}
	);

	it('should accept empty data', () => {
		expect(readHackathons({}).size).toBe(0);
	});
});
