export interface CheckpointScanSeedCliOptions {
	readonly rowLimit: number;
	readonly chunks: number;
	readonly durationMs: number;
	readonly untilComplete: boolean;
}

/** Finite by default; supervised continuation requires an explicit opt-in. */
export function parseCheckpointScanSeedCliOptions(
	args: readonly string[]
): CheckpointScanSeedCliOptions {
	if (!args.includes('--run'))
		throw new Error(
			'Explicit --run required for bounded scan coverage reconciliation'
		);
	const options = {
		rowLimit: 1_000,
		chunks: 1,
		durationMs: 10_000,
		untilComplete: false
	};
	const seen = new Set<string>();
	for (const arg of args) {
		const [key, value, extra] = arg.split('=');
		if (seen.has(key)) throw new Error('Duplicate scan seed option');
		seen.add(key);
		if (key === '--run' && value === undefined) continue;
		if (key === '--until-complete' && value === undefined) {
			options.untilComplete = true;
			continue;
		}
		if (
			extra !== undefined ||
			value === undefined ||
			!/^[1-9][0-9]*$/.test(value)
		)
			throw new Error('Invalid scan seed option');
		const parsed = Number(value);
		const maximum =
			key === '--rows'
				? 10_000
				: key === '--chunks'
					? 100
					: key === '--duration-ms'
						? 60_000
						: 0;
		if (!Number.isSafeInteger(parsed) || parsed > maximum)
			throw new Error('Unknown or out-of-range scan seed option');
		if (key === '--rows') options.rowLimit = parsed;
		else if (key === '--chunks') options.chunks = parsed;
		else options.durationMs = parsed;
	}
	if (
		options.untilComplete &&
		(seen.has('--chunks') || seen.has('--duration-ms'))
	)
		throw new Error(
			'--until-complete cannot be combined with finite run limits'
		);
	return options;
}
