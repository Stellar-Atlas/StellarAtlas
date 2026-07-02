export interface ScpBallotV1 {
	counter: number;
	value: string;
}

export interface ScpStatementConfirmV1 {
	ballot: ScpBallotV1;
	nPrepared: number;
	nCommit: number;
	nH: number;
	quorumSetHash: string;
}

export interface ScpStatementPrepareV1 {
	quorumSetHash: string;
	ballot: ScpBallotV1;
	prepared: ScpBallotV1 | null;
	preparedPrime: ScpBallotV1 | null;
	nC: number;
	nH: number;
}

export interface ScpStatementExternalizeV1 {
	quorumSetHash: string;
	nH: number;
	commit: ScpBallotV1;
}

export interface ScpNominationV1 {
	quorumSetHash: string;
	votes: string[];
	accepted: string[];
}

export type ScpStatementPledgesV1 =
	| ScpStatementPrepareV1
	| ScpStatementConfirmV1
	| ScpStatementExternalizeV1
	| ScpNominationV1;

export type ScpStatementTypeV1 =
	| 'externalize'
	| 'nominate'
	| 'confirm'
	| 'prepare';

export interface ScpStatementValueV1 {
	closeTime: string;
	txSetHash: string;
	upgradeCount: number;
	value: string;
}

export interface ScpStatementObservationV1 {
	nodeId: string;
	observedAt: string;
	observedFromAddress: string;
	observedFromPeer: string;
	pledges: ScpStatementPledgesV1;
	signature: string;
	slotIndex: string;
	statementHash: string;
	statementType: ScpStatementTypeV1;
	statementXdr: string;
	values: ScpStatementValueV1[];
}
