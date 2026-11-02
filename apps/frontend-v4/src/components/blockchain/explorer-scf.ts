import { recordValue } from '../../api/explorer-analytics';
import type { NodeTag } from '../../domain/network';

export function scfTags(value: unknown): readonly NodeTag[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry: unknown): NodeTag[] => {
		const item = recordValue(entry);
		if (typeof item.name !== 'string') return [];
		const rounds = Array.isArray(item.rounds)
			? item.rounds.filter((round) => typeof round === 'string')
			: [];

		return [
			{
				label: `SCF funded · ${item.name}`,
				title: rounds.length ? `Awarded in ${rounds.join(', ')}` : undefined,
				tone: 'good'
			}
		];
	});
}
