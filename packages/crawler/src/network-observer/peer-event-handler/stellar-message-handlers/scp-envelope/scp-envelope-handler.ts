import { hash, xdr } from '@stellar/stellar-sdk';
import { verifySCPEnvelopeSignature } from 'node-connector';
import { err, ok, Result } from 'neverthrow';
import { isLedgerSequenceValid } from './ledger-validator.js';
import { ScpStatementHandler } from './scp-statement/scp-statement-handler.js';
import type { Ledger } from '@crawler/crawler.js';
import { Observation } from '@network-observer/observation.js';
import { createScpStatementObservation } from '@network-observer/scp-statement-observation.js';

/*
 * ScpEnvelopeHandler makes sure that no duplicate SCP envelopes are processed, that the signature is valid and
 * that the ledger sequence is valid. It then delegates the SCP statement to the ScpStatementHandler.
 */
export class ScpEnvelopeHandler {
	constructor(private scpStatementHandler: ScpStatementHandler) {}

	public handle(
		scpEnvelope: xdr.ScpEnvelope,
		observation: Observation,
		observedFromPeer: string,
		observedFromAddress: string
	): Result<
		{
			closedLedger: Ledger | null;
		},
		Error
	> {
		if (this.isCached(scpEnvelope, observation))
			return ok({
				closedLedger: null
			});

		if (this.isValidLedger(observation, scpEnvelope))
			return ok({
				closedLedger: null
			});

		const verifiedSignature = this.verifySignature(scpEnvelope, observation);
		if (verifiedSignature.isErr()) return err(verifiedSignature.error);

		const observedStatement = createScpStatementObservation(
			scpEnvelope,
			observedFromPeer,
			observedFromAddress,
			new Date()
		);
		if (observedStatement.isErr()) return err(observedStatement.error);
		observation.recordScpStatementObservation(observedStatement.value);

		return this.scpStatementHandler.handle(scpEnvelope.statement, observation);
	}

	private verifySignature(
		scpEnvelope: xdr.ScpEnvelope,
		observation: Observation
	): Result<void, Error> {
		const verifiedResult = verifySCPEnvelopeSignature(
			scpEnvelope,
			Buffer.from(hash(Buffer.from(observation.network)))
		);
		if (verifiedResult.isErr())
			return err(new Error('Error verifying SCP Signature'));

		if (!verifiedResult.value) return err(new Error('Invalid SCP Signature'));

		return ok(undefined);
	}

	private isValidLedger(
		observation: Observation,
		scpEnvelope: xdr.ScpEnvelope
	) {
		return !isLedgerSequenceValid(
			observation.latestConfirmedClosedLedger,
			scpEnvelope.statement.slotIndex
		);
	}

	private isCached(
		scpEnvelope: xdr.ScpEnvelope,
		observation: Observation
	): boolean {
		const signature = Buffer.from(scpEnvelope.signature.toBytes()).toString(
			'base64'
		);
		if (observation.envelopeCache.has(signature)) return true;
		observation.envelopeCache.set(signature, 1);
		return false;
	}
}
