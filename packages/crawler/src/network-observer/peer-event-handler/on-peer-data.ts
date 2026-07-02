import { ConnectionManager, DataPayload } from '../connection-manager.js';
import type { Ledger } from '../../crawler.js';
import type { NodeAddress } from '../../node-address.js';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler.js';
import pino from 'pino';
import { Observation } from '../observation.js';
import { ObservationState } from '../observation-state.js';

export interface OnPeerDataResult {
	closedLedger: Ledger | null;
	peers: NodeAddress[];
}

export class OnPeerData {
	constructor(
		private stellarMessageHandler: StellarMessageHandler,
		private logger: pino.Logger,
		private connectionManager: ConnectionManager
	) {}

	public handle(data: DataPayload, observation: Observation): OnPeerDataResult {
		const attemptLedgerClose = this.attemptLedgerClose(observation);
		const result = this.performWork(data, observation, attemptLedgerClose);

		if (result.isErr()) {
			this.disconnect(data, result.error);
			return this.returnEmpty();
		}

		return this.createOnPeerDataResult(result.value);
	}

	private createOnPeerDataResult(result: {
		closedLedger: Ledger | null;
		peers: NodeAddress[];
	}): OnPeerDataResult {
		return {
			closedLedger: result.closedLedger,
			peers: result.peers
		};
	}

	private performWork(
		data: DataPayload,
		observation: Observation,
		attemptLedgerClose: boolean
	) {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			attemptLedgerClose,
			observation,
			data.address
		);

		data.stellarMessageWork.done();
		return result;
	}

	private attemptLedgerClose(observation: Observation) {
		return observation.state === ObservationState.Synced;
	}

	private returnEmpty() {
		return {
			closedLedger: null,
			peers: []
		};
	}

	private disconnect(data: DataPayload, error: Error) {
		this.logger.info({ peer: data.publicKey }, error.message);
		this.connectionManager.disconnectByAddress(data.address, error);
	}
}
