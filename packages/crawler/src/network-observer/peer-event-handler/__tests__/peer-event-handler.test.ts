import { mock } from 'jest-mock-extended';
import {
	ClosePayload,
	ConnectedPayload,
	DataPayload
} from '../../connection-manager.js';
import { OnPeerConnected } from '../on-peer-connected.js';
import { OnPeerConnectionClosed } from '../on-peer-connection-closed.js';
import { OnPeerData } from '../on-peer-data.js';
import { PeerEventHandler } from '../peer-event-handler.js';
import { Observation } from '../../observation.js';

describe('PeerConnectionEventHandler', () => {
	const onConnectedHandler = mock<OnPeerConnected>();
	const onConnectionCloseHandler = mock<OnPeerConnectionClosed>();
	const onPeerDataHandler = mock<OnPeerData>();
	const peerConnectionEventHandler = new PeerEventHandler(
		onConnectedHandler,
		onConnectionCloseHandler,
		onPeerDataHandler
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should call onConnectedHandler.handle', () => {
		const data = mock<ConnectedPayload>();
		const observation = mock<Observation>();
		peerConnectionEventHandler.onConnected(data, observation);
		expect(onConnectedHandler.handle).toHaveBeenCalledWith(data, observation);
	});

	it('should call onConnectionCloseHandler.handle', () => {
		const data = mock<ClosePayload>();
		const observation = mock<Observation>();
		peerConnectionEventHandler.onConnectionClose(data, observation);
		expect(onConnectionCloseHandler.handle).toHaveBeenCalledWith(
			data,
			observation
		);
	});

	it('should call onPeerDataHandler.handle', () => {
		const data = mock<DataPayload>();
		const observation = mock<Observation>();
		peerConnectionEventHandler.onData(data, observation);
		expect(onPeerDataHandler.handle).toHaveBeenCalledWith(data, observation);
	});
});
