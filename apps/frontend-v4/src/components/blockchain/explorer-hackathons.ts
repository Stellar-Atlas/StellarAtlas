import { recordValue } from '../../api/explorer-analytics';
import type { NodeTag } from '../../domain/network';

const awards: Readonly<Record<string, string>> = {
	first: '1st place',
	'runner-up': 'Runner-up'
};
const tracks: Readonly<Record<string, string>> = {
	genesis: 'Genesis',
	scale: 'Scale'
};

export function hackathonTags(value: unknown): readonly NodeTag[][] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry: unknown): NodeTag[][] => {
		const item = recordValue(entry);
		if (typeof item.name !== 'string' || typeof item.network !== 'string')
			return [];
		const award = typeof item.award === 'string' ? awards[item.award] : null;
		const track = typeof item.track === 'string' ? tracks[item.track] : null;
		const verified = item.evidence === 'verified';

		return [
			[
				{
					label: award ? `${item.name} · ${award}` : item.name,
					tone: award ? 'good' : 'neutral'
				},
				...(track ? [{ label: track, tone: 'neutral' as const }] : []),
				{ label: item.network, tone: 'neutral' },
				{
					label: verified ? 'on-chain verified' : 'code only',
					tone: verified ? 'good' : 'warning'
				}
			]
		];
	});
}
