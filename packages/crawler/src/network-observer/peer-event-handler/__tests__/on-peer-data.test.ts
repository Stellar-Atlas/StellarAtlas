import { ConnectionManager, DataPayload } from '../../connection-manager.js';
import { mock } from 'jest-mock-extended';
import pino from 'pino';
import { OnPeerData } from '../on-peer-data.js';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler.js';
import { createDummyExternalizeMessage } from '@fixtures/createDummyExternalizeMessage.js';
import { err, ok } from 'neverthrow';
import { PeerNodeCollection } from '@crawler/peer-node-collection.js';
import type { Ledger } from '@crawler/crawler.js';
import type { NodeAddress } from '@crawler/node-address.js';
import { Observation } from '../../observation.js';
import { ObservationState } from '../../observation-state.js';
import { QuorumSet } from 'shared';
import { Slots } from '../stellar-message-handlers/scp-envelope/scp-statement/externalize/slots.js';

describe('OnDataHandler', () => {
	const connectionManager = mock<ConnectionManager>();
	const stellarMessageHandler = mock<StellarMessageHandler>();
	const logger = mock<pino.Logger>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	function createDataHandler() {
		return new OnPeerData(stellarMessageHandler, logger, connectionManager);
	}

	function createObservation(): Observation {
		return new Observation(
			'test',
			[],
			mock<PeerNodeCollection>(),
			mock<Ledger>(),
			new Map<string, QuorumSet>(),
			new Slots(new QuorumSet(1, ['A'], []), logger)
		);
	}

	function createData() {
		const data: DataPayload = {
			publicKey: 'publicKey',
			stellarMessageWork: {
				stellarMessage: createDummyExternalizeMessage(),
				done: jest.fn()
			},
			address: 'address'
		};
		return data;
	}

	function createSuccessfulResult() {
		const result: {
			closedLedger: Ledger | null;
			peers: NodeAddress[];
		} = {
			closedLedger: {
				sequence: BigInt(1),
				closeTime: new Date(),
				value: 'value',
				localCloseTime: new Date()
			},
			peers: [['address', 11625]]
		};
		return result;
	}

	it('should handle data successfully in Synced state and attempt slot close', () => {
		const onDataHandler = createDataHandler();
		const data = createData();
		const result = createSuccessfulResult();

		stellarMessageHandler.handleStellarMessage.mockReturnValue(ok(result));

		const observation = createObservation();
		observation.state = ObservationState.Synced;
		const receivedResult = onDataHandler.handle(data, observation);

		expect(stellarMessageHandler.handleStellarMessage).toHaveBeenCalledWith(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			true,
			observation,
			data.address
		);
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(receivedResult).toEqual(result);
	});

	it('should handle data successfully but not attempt slot close if not in synced mode', () => {
		const onDataHandler = createDataHandler();
		const data = createData();
		const observation = createObservation();
		observation.state = ObservationState.Syncing;
		const result = createSuccessfulResult();
		stellarMessageHandler.handleStellarMessage.mockReturnValue(ok(result));

		const receivedResult = onDataHandler.handle(data, observation);

		expect(stellarMessageHandler.handleStellarMessage).toHaveBeenCalledWith(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			false,
			observation,
			data.address
		);
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(receivedResult).toEqual(result);
	});

	it('should handle data error', () => {
		const onDataHandler = createDataHandler();
		const data = createData();

		stellarMessageHandler.handleStellarMessage.mockReturnValue(
			err(new Error('error'))
		);
		const result = onDataHandler.handle(data, createObservation());
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			data.address,
			new Error('error')
		);
		expect(result).toEqual({ closedLedger: null, peers: [] });
	});
});
