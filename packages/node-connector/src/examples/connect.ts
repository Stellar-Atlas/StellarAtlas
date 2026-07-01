import { StrKey, xdr } from '@stellar/stellar-sdk';
import {
	createNode,
	getConfigFromEnv,
	type NodeInfo,
	type StellarMessageWork
} from '../index.js';

type TargetNode = {
	ip: string;
	port: number;
};

const defaultNodePort = 11625;
const node = createNode(getConfigFromEnv());

function readTargetNode(): TargetNode {
	const ip = process.argv[2];
	if (ip === undefined) {
		console.log('Parameters: NODE_IP(required) NODE_PORT(default: 11625)');
		process.exit(1);
	}

	const portArg = process.argv[3];
	const port = portArg === undefined ? defaultNodePort : Number(portArg);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		console.log(`Invalid NODE_PORT: ${portArg}`);
		process.exit(1);
	}

	return { ip, port };
}

function logConnection(publicKey: string, nodeInfo: NodeInfo): void {
	console.log(`Connected to Stellar Node: ${publicKey}`);
	console.log(nodeInfo);
}

function logScpMessage(stellarMessage: xdr.StellarMessage): void {
	const statement = stellarMessage.envelope().statement();
	const publicKey = StrKey.encodeEd25519PublicKey(
		statement.nodeId().value()
	).toString();
	const pledgeType = statement.pledges().switch();

	console.log(
		`${publicKey} sent StellarMessage of type ${pledgeType.name} for ledger ${statement.slotIndex().toString()}`
	);

	if (pledgeType !== xdr.ScpStatementType.scpStExternalize()) return;

	const value = statement.pledges().externalize().commit().value();
	const closeTime = xdr.StellarValue.fromXDR(value)
		.closeTime()
		.toXDR()
		.readBigUInt64BE();

	console.log(new Date(1000 * Number(closeTime)));
}

function logOtherMessage(stellarMessage: xdr.StellarMessage): void {
	console.log(
		`rcv StellarMessage of type ${stellarMessage.switch().name}: ${stellarMessage.toXDR('base64')}`
	);

	if (stellarMessage.switch().value !== 0) return;

	console.log(stellarMessage.error().msg().toString());
	console.log(stellarMessage.error().code());
}

function handleData(stellarMessageJob: StellarMessageWork): void {
	const stellarMessage = stellarMessageJob.stellarMessage;

	switch (stellarMessage.switch()) {
		case xdr.MessageType.scpMessage():
			logScpMessage(stellarMessage);
			break;
		default:
			logOtherMessage(stellarMessage);
			break;
	}

	stellarMessageJob.done();
}

function connect(): void {
	const targetNode = readTargetNode();
	const connection = node.connectTo(targetNode.ip, targetNode.port);

	connection
		.on('connect', logConnection)
		.on('data', handleData)
		.on('error', (error: Error) => {
			console.log(error);
		})
		.on('close', () => {
			console.log('closed connection');
		})
		.on('timeout', () => {
			console.log('timeout');
			connection.destroy();
		});
}

connect();
