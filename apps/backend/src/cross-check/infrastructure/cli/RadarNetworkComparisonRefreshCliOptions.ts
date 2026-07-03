import { RadarNetworkSnapshotSourceAdapter } from '../radar/RadarNetworkSnapshotSourceAdapter.js';

export interface RadarNetworkComparisonRefreshCliOptions {
	readonly freshnessMs: number;
	readonly intervalMs: number;
	readonly loop: boolean;
	readonly radarMaxBytes: number;
	readonly radarTimeoutMs: number;
}

const defaultIntervalMs = 6 * 60 * 60 * 1000;
const defaultFreshnessMs = 6 * 60 * 60 * 1000;
const minIntervalMs = 60 * 1000;
const maxIntervalMs = 7 * 24 * 60 * 60 * 1000;
const minRadarTimeoutMs = 100;
const maxRadarTimeoutMs = 60 * 1000;
const minRadarMaxBytes = 1;
const maxRadarMaxBytes = 5_000_000;
const optionNames = new Set([
	'freshness-ms',
	'interval-ms',
	'radar-max-bytes',
	'radar-timeout-ms'
]);

export function parseRadarNetworkComparisonRefreshCliOptions(
	args: readonly string[]
): RadarNetworkComparisonRefreshCliOptions {
	const values = new Map<string, string>();
	let loop = false;

	for (const arg of args) {
		if (arg === '--loop') {
			loop = true;
			continue;
		}

		const match = arg.match(/^--([a-z-]+)=(.*)$/);
		if (match === null) throw new Error(`Unsupported argument: ${arg}`);
		if (!optionNames.has(match[1])) {
			throw new Error(`Unsupported argument: ${arg}`);
		}
		values.set(match[1], match[2]);
	}

	return {
		freshnessMs: parseBoundedInteger(
			values.get('freshness-ms'),
			defaultFreshnessMs,
			0,
			maxIntervalMs,
			'freshness-ms'
		),
		intervalMs: parseBoundedInteger(
			values.get('interval-ms'),
			defaultIntervalMs,
			minIntervalMs,
			maxIntervalMs,
			'interval-ms'
		),
		loop,
		radarMaxBytes: parseBoundedInteger(
			values.get('radar-max-bytes'),
			RadarNetworkSnapshotSourceAdapter.defaultMaxBytes,
			minRadarMaxBytes,
			maxRadarMaxBytes,
			'radar-max-bytes'
		),
		radarTimeoutMs: parseBoundedInteger(
			values.get('radar-timeout-ms'),
			RadarNetworkSnapshotSourceAdapter.defaultTimeoutMs,
			minRadarTimeoutMs,
			maxRadarTimeoutMs,
			'radar-timeout-ms'
		)
	};
}

function parseBoundedInteger(
	value: string | undefined,
	defaultValue: number,
	min: number,
	max: number,
	name: string
): number {
	if (value === undefined || value.trim() === '') return defaultValue;

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${name} must be an integer from ${min} to ${max}`);
	}

	return parsed;
}
