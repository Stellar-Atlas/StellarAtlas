export const publicNetworkPassphrase =
	'Public Global Stellar Network ; September 2015';
export const firstPublicNetworkScpCheckpoint = 0x0012867f;

interface HistoryArchiveScpSqlInput {
	readonly checkpointLedgerSql: string;
	readonly networkPassphraseSql: string;
	readonly protocolVersionSql: string;
}

export function isHistoryArchiveScpObjectExpected(input: {
	readonly checkpointLedger: number;
	readonly networkPassphrase?: string | null;
	readonly protocolVersion?: number | null;
}): boolean {
	if (
		!Number.isSafeInteger(input.checkpointLedger) ||
		input.checkpointLedger < 0
	) {
		return false;
	}
	if (input.checkpointLedger >= firstPublicNetworkScpCheckpoint) return true;

	const networkPassphrase = input.networkPassphrase?.trim() ?? '';
	if (
		networkPassphrase === '' ||
		networkPassphrase === publicNetworkPassphrase
	) {
		return false;
	}

	// Scheduling has no ledger facts yet. Proof evaluation passes an explicit
	// protocol value and stays non-evaluable until that fact is available.
	return input.protocolVersion === undefined || input.protocolVersion !== null;
}

export function historyArchiveScpExpectationSql(
	input: HistoryArchiveScpSqlInput
): string {
	return `(
		${input.checkpointLedgerSql} >= ${firstPublicNetworkScpCheckpoint}
		or (
			coalesce(trim(${input.networkPassphraseSql}), '') <> ''
			and ${input.networkPassphraseSql} <> '${publicNetworkPassphrase}'
			and ${input.protocolVersionSql} is not null
		)
	)`;
}

export function historyArchiveScpExpectationKnownSql(
	input: HistoryArchiveScpSqlInput
): string {
	return `(
		${input.checkpointLedgerSql} >= ${firstPublicNetworkScpCheckpoint}
		or (
			coalesce(trim(${input.networkPassphraseSql}), '') <> ''
			and (
				${input.networkPassphraseSql} = '${publicNetworkPassphrase}'
				or ${input.protocolVersionSql} is not null
			)
		)
	)`;
}
