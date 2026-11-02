import { scfTags } from '../explorer-scf';

describe('scfTags', () => {
	it('should make one badge of a funded project', () => {
		expect(
			scfTags([
				{ slug: 'blend', name: 'Blend Capital', rounds: ['SCF #27', 'SCF #29'] }
			])
		).toEqual([
			{
				label: 'SCF funded · Blend Capital',
				title: 'Awarded in SCF #27, SCF #29',
				tone: 'good'
			}
		]);
	});

	it.each([undefined, null, 'text', {}, [null, 1, { name: 1 }]])(
		'should ignore a malformed value %j',
		(value) => {
			expect(scfTags(value)).toEqual([]);
		}
	);
});
