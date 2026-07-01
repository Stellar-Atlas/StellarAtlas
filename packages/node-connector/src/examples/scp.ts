import { createNode, getConfigFromEnv, ScpReader } from '../index.js';
import pino from 'pino';

type TargetNode = {
	ip: string;
	port: number;
};

type NodeApiRecord = {
	publicKey: string;
	name?: string | null;
};

const defaultNodePort = 11625;
const nodesApiUrl = 'https://api.stellaratlas.io/v1/nodes';
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

async function fetchNodeNames(): Promise<Map<string, string>> {
	const response = await fetch(nodesApiUrl);
	if (!response.ok)
		throw new Error(`Could not fetch node names: HTTP ${response.status}`);

	const records = (await response.json()) as readonly NodeApiRecord[];
	if (!Array.isArray(records))
		throw new Error('Could not fetch node names: response was not an array');

	return new Map(
		records
			.filter((record) => typeof record.publicKey === 'string')
			.map((record) => [record.publicKey, record.name ?? record.publicKey])
	);
}

async function connect(): Promise<void> {
	const targetNode = readTargetNode();
	const nodeNames = await fetchNodeNames();
	const scpReader = new ScpReader(pino());

	scpReader.read(node, targetNode.ip, targetNode.port, nodeNames);
}

connect().catch((error: Error) => {
	console.error(error.message);
	process.exit(1);
});
