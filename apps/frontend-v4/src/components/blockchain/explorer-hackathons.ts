import { recordValue } from '../../api/explorer-analytics';

const awards: Readonly<Record<string, string>> = {
	first: '1st place',
	'runner-up': 'Runner-up'
};
const tracks: Readonly<Record<string, string>> = {
	genesis: 'Genesis',
	scale: 'Scale'
};

export function hackathonLabels(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry: unknown): string[] => {
		const item = recordValue(entry);
		if (typeof item.name !== 'string' || typeof item.network !== 'string')
			return [];
		const award = typeof item.award === 'string' ? awards[item.award] : null;
		const track = typeof item.track === 'string' ? tracks[item.track] : null;

		return [
			[
				`${item.name} (${item.network})`,
				award,
				track,
				item.evidence === 'verified' ? 'on-chain verified' : 'code only'
			]
				.filter(Boolean)
				.join(' · ')
		];
	});
}
