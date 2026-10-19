import type { ExplorerFilters } from '../../api/explorer-analytics';

export interface EventControls {
	type: string;
	order: 'asc' | 'desc';
	limit: string;
	topic: string;
	q: string;
}

const eventTypes = new Set(['0', '1', '2']);
const eventLimits = new Set(['10', '25', '50', '100']);
const eventFilterKeys = [
	'type_code',
	'order',
	'limit',
	'topic',
	'q',
	'after',
	'offset'
];

export function createEventControls(filters: ExplorerFilters): EventControls {
	const type = filters.type_code ?? '';
	const limit = filters.limit ?? '';
	return {
		type: eventTypes.has(type) ? type : 'all',
		order: filters.order === 'asc' ? 'asc' : 'desc',
		limit: eventLimits.has(limit) ? limit : '25',
		topic: filters.topic?.trim() ?? '',
		q: filters.q?.trim() ?? ''
	};
}

export function applyEventControls(
	filters: ExplorerFilters,
	controls: EventControls
): Record<string, string> {
	const next = Object.fromEntries(
		Object.entries(filters).filter(([key]) => !eventFilterKeys.includes(key))
	);
	const type = eventTypes.has(controls.type) ? controls.type : 'all';
	const order = controls.order === 'asc' ? 'asc' : 'desc';
	const limit = eventLimits.has(controls.limit) ? controls.limit : '25';
	const topic = controls.topic.trim();
	const q = controls.q.trim();

	if (type !== 'all') next.type_code = type;
	next.order = order;
	next.limit = limit;
	if (topic) next.topic = topic;
	if (q) next.q = q;
	return next;
}
