import { Networks } from '@stellar/stellar-sdk';
import { isAbsolute, parse, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import { validatePublicProtocolPositionReferences } from '../../network-scan/infrastructure/http/ExplorerAccountProtocolPositionComposition.js';
import { record } from '../../status/infrastructure/http/contract-provenance/ContractBuildAttestation.js';

const maxConfigBytes = 16 * 1024;
const maxObjectBytes = 1024 * 1024;
const maxObjects = 48;

export interface ExplorerAccountProtocolPositionConfig {
	readonly root: string;
	readonly limits: {
		readonly maxBytes: number;
		readonly maxObjects: number;
		readonly maxObjectBytes: number;
	};
	readonly recentWithinMs: number;
	readonly references: readonly unknown[];
}

export function parseExplorerAccountProtocolPositionConfig(
	env: NodeJS.ProcessEnv,
	networkPassphrase: string
): Result<ExplorerAccountProtocolPositionConfig | undefined, Error> {
	const enabled = env.EXPLORER_ACCOUNT_PROTOCOL_POSITIONS_ENABLED;
	if (enabled === undefined || enabled === 'false') return ok(undefined);
	if (enabled !== 'true')
		return err(
			new Error(
				'EXPLORER_ACCOUNT_PROTOCOL_POSITIONS_ENABLED must be true or false'
			)
		);
	if (networkPassphrase !== Networks.PUBLIC)
		return err(new Error('Account protocol positions require Stellar Mainnet'));

	const raw = env.EXPLORER_ACCOUNT_PROTOCOL_POSITIONS_CONFIG;
	if (raw === undefined || Buffer.byteLength(raw, 'utf8') > maxConfigBytes)
		return err(
			new Error(
				'Account protocol positions require a configuration of at most 16 KiB'
			)
		);

	let config: Record<string, unknown>;
	try {
		config = record(JSON.parse(raw));
	} catch {
		return err(
			new Error('Invalid account protocol position configuration JSON')
		);
	}
	const { root, limits, recentWithinMs, references } = config;
	if (
		Object.keys(config).some(
			(key) => !['root', 'limits', 'recentWithinMs', 'references'].includes(key)
		)
	)
		return err(
			new Error('Invalid account protocol position configuration fields')
		);
	if (
		typeof root !== 'string' ||
		root.length > 1024 ||
		root.trim() !== root ||
		root.includes('\0') ||
		!isAbsolute(root) ||
		resolve(root) === parse(root).root
	)
		return err(
			new Error(
				'Account protocol positions require an explicit absolute private root'
			)
		);
	if (!boundedInteger(recentWithinMs, 1_000, 86_400_000))
		return err(
			new Error(
				'Account protocol positions require a recent window between 1000 and 86400000 ms'
			)
		);

	const bounded = record(limits);
	const {
		maxBytes,
		maxObjects: objects,
		maxObjectBytes: objectBytes
	} = bounded;
	if (
		Object.keys(bounded).length !== 3 ||
		!boundedInteger(objects, 1, maxObjects) ||
		!boundedInteger(maxBytes, 1, maxObjects * maxObjectBytes) ||
		!boundedInteger(objectBytes, 1, Math.min(maxBytes, maxObjectBytes))
	)
		return err(new Error('Invalid account protocol position retention limits'));
	if (!validatePublicProtocolPositionReferences(references))
		return err(
			new Error(
				'Account protocol positions require 1 to 16 distinct completed public references'
			)
		);

	return ok({
		root,
		limits: { maxBytes, maxObjects: objects, maxObjectBytes: objectBytes },
		recentWithinMs,
		references
	});
}

function boundedInteger(
	value: unknown,
	minimum: number,
	maximum: number
): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= minimum &&
		value <= maximum
	);
}
