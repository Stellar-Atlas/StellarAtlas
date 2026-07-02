import { hash, xdr } from '@stellar/stellar-sdk';
import {
	SCPStatement,
	ScpStatementPledges,
	ScpBallot
} from 'node-connector';
import { err, ok, Result } from 'neverthrow';

export interface StellarValueSummary {
	closeTime: string;
	txSetHash: string;
	upgradeCount: number;
	value: string;
}

export interface ScpStatementObservation {
	nodeId: string;
	observedAt: Date;
	observedFromAddress: string;
	observedFromPeer: string;
	pledges: ScpStatementPledges;
	signature: string;
	slotIndex: string;
	statementHash: string;
	statementType: SCPStatement['type'];
	statementXdr: string;
	values: StellarValueSummary[];
}

export function createScpStatementObservation(
	scpEnvelope: xdr.ScpEnvelope,
	observedFromPeer: string,
	observedFromAddress: string,
	observedAt: Date
): Result<ScpStatementObservation, Error> {
	const statementResult = SCPStatement.fromXdr(scpEnvelope.statement());
	if (statementResult.isErr()) return err(statementResult.error);

	const statement = statementResult.value;
	const statementXdr = scpEnvelope.statement().toXDR();

	return ok({
		nodeId: statement.nodeId,
		observedAt,
		observedFromAddress,
		observedFromPeer,
		pledges: statement.pledges,
		signature: scpEnvelope.signature().toString('base64'),
		slotIndex: statement.slotIndex,
		statementHash: hash(statementXdr).toString('base64'),
		statementType: statement.type,
		statementXdr: statementXdr.toString('base64'),
		values: getStellarValues(statement.pledges)
	});
}

function getStellarValues(pledges: ScpStatementPledges): StellarValueSummary[] {
	const values = new Map<string, StellarValueSummary>();
	for (const value of getRawValues(pledges)) {
		const summary = decodeStellarValue(value);
		if (summary !== null) values.set(summary.value, summary);
	}
	return Array.from(values.values());
}

function getRawValues(pledges: ScpStatementPledges): string[] {
	if ('votes' in pledges) return pledges.votes.concat(pledges.accepted);
	if ('commit' in pledges) return [pledges.commit.value];
	if ('nCommit' in pledges) return [pledges.ballot.value];

	return getBallotValues([
		pledges.ballot,
		pledges.prepared,
		pledges.preparedPrime
	]);
}

function getBallotValues(ballots: (ScpBallot | null)[]): string[] {
	return ballots
		.filter((ballot): ballot is ScpBallot => ballot !== null)
		.map((ballot) => ballot.value);
}

function decodeStellarValue(value: string): StellarValueSummary | null {
	try {
		const stellarValue = xdr.StellarValue.fromXDR(Buffer.from(value, 'base64'));
		return {
			closeTime: stellarValue.closeTime().toString(),
			txSetHash: stellarValue.txSetHash().toString('base64'),
			upgradeCount: stellarValue.upgrades().length,
			value
		};
	} catch {
		return null;
	}
}
