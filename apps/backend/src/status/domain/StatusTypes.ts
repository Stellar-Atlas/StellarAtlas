export type StatusLevel = 'ok' | 'degraded' | 'unavailable';

export interface ApiStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly service: 'api';
}

export function getWorstStatus(statuses: readonly StatusLevel[]): StatusLevel {
	if (statuses.includes('unavailable')) return 'unavailable';
	if (statuses.includes('degraded')) return 'degraded';
	return 'ok';
}
