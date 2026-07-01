import type { NodeConfig } from './node-config.js';
export type { NodeConfig } from './node-config.js';
import { Node } from './node.js';
import { hash, Keypair } from '@stellar/stellar-sdk';
import { ConnectionAuthentication } from './connection/connection-authentication.js';
import pino from 'pino';

export { Node } from './node.js';
export { Connection } from './connection/connection.js';
export { UniqueSCPStatementTransform } from './unique-scp-statement-transform.js';
export { StellarMessageRouter } from './stellar-message-router.js';
export type { MessageTypeName } from './stellar-message-router.js';
export { SCPStatement } from './scp-statement-dto.js';
export type {
	ScpBallot,
	SCPStatementType,
	ScpStatementPledges,
	ScpStatementPrepare,
	ScpStatementConfirm,
	ScpStatementExternalize,
	ScpNomination
} from './scp-statement-dto.js';
export { getConfigFromEnv } from './node-config.js';
export { ScpReader } from './scp-reader.js';
export type { StellarMessageWork } from './connection/connection.js';
export type { NodeInfo } from './node.js';
export {
	getPublicKeyStringFromBuffer,
	createSCPEnvelopeSignature,
	createStatementXDRSignature,
	getIpFromPeerAddress,
	verifySCPEnvelopeSignature,
	getQuorumSetFromMessage
} from './stellar-message-service.js'; //todo: separate package?
export type { QuorumSetDTO } from './stellar-message-service.js';

export function createNode(config: NodeConfig, logger?: pino.Logger): Node {
	if (!logger) {
		logger = pino({
			level: process.env.LOG_LEVEL || 'info',
			base: undefined
		});
	}

	logger = logger.child({ app: 'Connector' });

	let keyPair: Keypair;
	if (config.privateKey) {
		try {
			keyPair = Keypair.fromSecret(config.privateKey);
		} catch (error) {
			throw new Error('Invalid private key');
		}
	} else {
		keyPair = Keypair.random();
	}

	const networkId = hash(Buffer.from(config.network));

	const connectionAuthentication = new ConnectionAuthentication(
		keyPair,
		networkId
	);

	return new Node(config, keyPair, connectionAuthentication, logger);
}
