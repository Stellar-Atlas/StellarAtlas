import { readScf, scfProjectsOf } from '../ScfParticipation.js';

const valid = {
	projects: { app: { name: 'App', rounds: ['SCF #1'] } },
	repositories: { 'team/app': ['app'] },
	owners: { team: ['app'] }
};

describe('scfProjectsOf', () => {
	it('should match a repository without regard to case', () => {
		expect(scfProjectsOf('Stellar-Scaffold/CLI')).toEqual([
			expect.objectContaining({ slug: 'scaffold-stellar' })
		]);
	});

	it('should match any repository of a funded organization', () => {
		expect(scfProjectsOf('troqpay/private-yield')).toEqual([
			{ slug: 'troqpay', name: 'TroqPay', rounds: ['SCF #44'] }
		]);
	});

	it('should return nothing for an unfunded repository or inherited keys', () => {
		expect(scfProjectsOf('stellar/rs-soroban-sdk')).toEqual([]);
		expect(scfProjectsOf(null)).toEqual([]);
		expect(scfProjectsOf('__proto__/x')).toEqual([]);
	});
});

describe('readScf', () => {
	it.each([
		[
			'an upper-case repository',
			{ ...valid, repositories: { 'Team/App': ['app'] } }
		],
		['an unknown project', { ...valid, owners: { team: ['x'] } }],
		[
			'a project without rounds',
			{ ...valid, projects: { app: { name: 'App', rounds: [] } } }
		]
	])(
		'should refuse %s, so bad data stops the server at startup',
		(_name, data) => {
			expect(() => readScf(data)).toThrow(/scf\.json/);
		}
	);
});
