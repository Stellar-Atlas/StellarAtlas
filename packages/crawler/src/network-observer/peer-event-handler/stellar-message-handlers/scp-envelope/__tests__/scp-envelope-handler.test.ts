import { mock } from 'jest-mock-extended';
import { ScpStatementHandler } from '../scp-statement/scp-statement-handler.js';
import { ScpEnvelopeHandler } from '../scp-envelope-handler.js';
import { createDummyExternalizeScpEnvelope } from '@fixtures/createDummyExternalizeMessage.js';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { ok } from 'neverthrow';
import { Observation } from '@network-observer/observation.js';
import { LRUCache } from 'lru-cache';

describe('scp-envelope-handler', () => {
	const observedFromPeer = 'observed-peer';
	const observedFromAddress = '127.0.0.1:11625';

	it('should process valid scp envelope and return closed ledger', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const closedLedger = {
			sequence: BigInt(2),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		scpStatementHandler.handle.mockReturnValueOnce(ok({ closedLedger }));
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = createMockObservation();
		const result = handler.handle(
			scpEnvelope,
			crawlState,
			observedFromPeer,
			observedFromAddress
		);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(1);
		expect(crawlState.recordScpStatementObservation).toHaveBeenCalledTimes(1);
		const observation =
			crawlState.recordScpStatementObservation.mock.calls[0]?.[0];
		expect(observation?.observedFromPeer).toBe(observedFromPeer);
		expect(observation?.observedFromAddress).toBe(observedFromAddress);
		expect(observation?.statementType).toBe('externalize');
		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) return;
		expect(result.value.closedLedger).toEqual(closedLedger);
	});

	it('should not process duplicate scp envelope', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = createMockObservation();
		handler.handle(
			scpEnvelope,
			crawlState,
			observedFromPeer,
			observedFromAddress
		);
		handler.handle(
			scpEnvelope,
			crawlState,
			observedFromPeer,
			observedFromAddress
		);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(1);
		expect(crawlState.recordScpStatementObservation).toHaveBeenCalledTimes(1);
	});

	it('should not process scp envelope with invalid (too old) ledger', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = createMockObservation(BigInt(100));
		handler.handle(
			scpEnvelope,
			crawlState,
			observedFromPeer,
			observedFromAddress
		);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
		expect(crawlState.recordScpStatementObservation).toHaveBeenCalledTimes(0);
	});

	it('should not process scp envelope with invalid signature', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope(
			Keypair.random(),
			Buffer.from('wrong network')
		);
		const crawlState = createMockObservation();
		const result = handler.handle(
			scpEnvelope,
			crawlState,
			observedFromPeer,
			observedFromAddress
		);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
		expect(crawlState.recordScpStatementObservation).toHaveBeenCalledTimes(0);
		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error.message).toEqual('Invalid SCP Signature');
	});

	function createMockObservation(sequence = BigInt(1)) {
		const observation = mock<Observation>();
		observation.latestConfirmedClosedLedger = {
			sequence: sequence,
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		observation.network = Networks.PUBLIC;
		observation.envelopeCache = new LRUCache<string, number>({ max: 1000 });
		return observation;
	}

	it('should not process scp envelope when processing SCP signature fails', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		scpEnvelope.signature(Buffer.alloc(20)); // invalid signature
		const crawlState = createMockObservation();
		const result = handler.handle(
			scpEnvelope,
			crawlState,
			observedFromPeer,
			observedFromAddress
		);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
		expect(crawlState.recordScpStatementObservation).toHaveBeenCalledTimes(0);
		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error.message).toEqual('Error verifying SCP Signature');
	});
});
