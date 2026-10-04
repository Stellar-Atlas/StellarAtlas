import { StrKey, xdr } from '@stellar/stellar-sdk';
import { err, ok, Result } from 'neverthrow';

export type ScpStatementPledges =
	| ScpStatementPrepare
	| ScpStatementConfirm
	| ScpStatementExternalize
	| ScpNomination;

export interface ScpStatementConfirm {
	ballot: ScpBallot;
	nPrepared: number;
	nCommit: number;
	nH: number;
	quorumSetHash: string;
}

export interface ScpStatementPrepare {
	quorumSetHash: string;
	ballot: ScpBallot;
	prepared: null | ScpBallot;
	preparedPrime: null | ScpBallot;
	nC: number;
	nH: number;
}

export interface ScpBallot {
	counter: number;
	value: string; //base64
}

export interface ScpStatementExternalize {
	quorumSetHash: string;
	nH: number;
	commit: ScpBallot;
}

export interface ScpNomination {
	quorumSetHash: string;
	votes: string[];
	accepted: string[];
}

export type SCPStatementType =
	'externalize' | 'nominate' | 'confirm' | 'prepare';

export class SCPStatement {
	nodeId: string;
	slotIndex: string;
	type: SCPStatementType;
	pledges: ScpStatementPledges;

	constructor(
		nodeId: string,
		slotIndex: string,
		type: SCPStatementType,
		pledges: ScpStatementPledges
	) {
		this.nodeId = nodeId;
		this.slotIndex = slotIndex;
		this.type = type;
		this.pledges = pledges;
	}

	static fromXdr(
		xdrInput: string | xdr.ScpStatement
	): Result<SCPStatement, Error> {
		if (typeof xdrInput === 'string') {
			const buffer = Buffer.from(xdrInput, 'base64');
			xdrInput = xdr.ScpStatement.fromXdr(buffer);
		}

		const nodeId = StrKey.encodeEd25519PublicKey(
			xdrInput.nodeId.value.toBytes()
		).toString(); //slow! cache!
		const slotIndex = xdrInput.slotIndex.toString();
		const xdrPledges = xdrInput.pledges;
		let pledges: ScpStatementPledges;
		let type: SCPStatementType;

		if (xdrPledges.type === 'scpStExternalize') {
			type = 'externalize';
			const statement = xdrPledges.externalize;
			pledges = {
				quorumSetHash: Buffer.from(
					statement.commitQuorumSetHash.toBytes()
				).toString('base64'),
				nH: statement.nH,
				commit: {
					counter: statement.commit.counter,
					value: Buffer.from(statement.commit.value.toBytes()).toString(
						'base64'
					)
				}
			};
		} else if (xdrPledges.type === 'scpStConfirm') {
			const statement = xdrPledges.confirm;
			type = 'confirm';
			pledges = {
				quorumSetHash: Buffer.from(statement.quorumSetHash.toBytes()).toString(
					'base64'
				),
				nH: statement.nH,
				nPrepared: statement.nPrepared,
				nCommit: statement.nCommit,
				ballot: {
					counter: statement.ballot.counter,
					value: Buffer.from(statement.ballot.value.toBytes()).toString(
						'base64'
					)
				}
			};
		} else if (xdrPledges.type === 'scpStNominate') {
			const statement = xdrPledges.nominate;
			type = 'nominate';
			pledges = {
				quorumSetHash: Buffer.from(statement.quorumSetHash.toBytes()).toString(
					'base64'
				),
				votes: statement.votes.map((vote) =>
					Buffer.from(vote.toBytes()).toString('base64')
				),
				accepted: statement.accepted.map((vote) =>
					Buffer.from(vote.toBytes()).toString('base64')
				)
			};
		} else if (xdrPledges.type === 'scpStPrepare') {
			type = 'prepare';
			const statement = xdrPledges.prepare;
			const prepared = statement.prepared;
			const preparedPrime = statement.preparedPrime;
			pledges = {
				quorumSetHash: Buffer.from(statement.quorumSetHash.toBytes()).toString(
					'base64'
				),
				ballot: {
					counter: statement.ballot.counter,
					value: Buffer.from(statement.ballot.value.toBytes()).toString(
						'base64'
					)
				},
				prepared: prepared
					? {
							counter: prepared.counter,
							value: Buffer.from(prepared.value.toBytes()).toString('base64')
						}
					: null,
				preparedPrime: preparedPrime
					? {
							counter: preparedPrime.counter,
							value: Buffer.from(preparedPrime.value.toBytes()).toString(
								'base64'
							)
						}
					: null,
				nC: statement.nC,
				nH: statement.nH
			};
		} else {
			return err(new Error('unknown SCP pledge type'));
		}

		return ok(new SCPStatement(nodeId, slotIndex, type, pledges));
	}
}
