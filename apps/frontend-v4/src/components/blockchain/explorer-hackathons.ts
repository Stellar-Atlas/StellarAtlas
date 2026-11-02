import { recordValue } from '../../api/explorer-analytics';
import type { NodeTag } from '../../domain/network';

const awards: Readonly<Record<string, string>> = {
	first: '1st place',
	'runner-up': 'Runner-up'
};

export function hackathonTags(value: unknown): readonly NodeTag[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry: unknown): NodeTag[] => {
		const item = recordValue(entry);
		if (typeof item.name !== 'string' || typeof item.network !== 'string')
			return [];
		const award = typeof item.award === 'string' ? awards[item.award] : null;

		return [
			{
				label: award ? `${item.name} · ${award}` : item.name,
				title: `${item.name} ran on ${item.network}`,
				tone: award ? 'good' : 'neutral'
			}
		];
	});
}
