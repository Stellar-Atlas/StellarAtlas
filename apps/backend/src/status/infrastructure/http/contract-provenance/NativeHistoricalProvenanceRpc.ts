import { performance } from 'node:perf_hooks';
import { fetchRpcJson } from './BoundedProvenanceJson.js';
import { record } from './ContractBuildAttestation.js';
import {
	ContractRpcUnavailable,
	readContractCode,
	type ContractCodeObservation
} from './ContractRpcCode.js';
import type { RpcEndpoint } from './ProvenanceEndpointPolicy.js';

const RPC_DEADLINE_MS = 8_000;
const MAX_LEDGER_ADVANCE = 8;

// This binds observations to the selected network and ledger. Native RPC can
// lag the network, so this path neither checks health nor grants freshness.
export async function readNativeHistoricalProvenance(
	endpoint: RpcEndpoint<'native'>,
	networkPassphrase: string,
	contractId: string
): Promise<ContractCodeObservation> {
	const deadline = performance.now() + RPC_DEADLINE_MS;
	let id = 0;
	async function call(method: 'getNetwork' | 'getLedgerEntries', key?: string) {
		const timeoutMs = Math.floor(deadline - performance.now());
		if (timeoutMs <= 0)
			throw new Error('Native provenance RPC deadline expired');
		const requestId = ++id;
		const response = record(
			await fetchRpcJson(
				endpoint,
				{
					jsonrpc: '2.0',
					id: requestId,
					method,
					...(key === undefined ? {} : { params: { keys: [key] } })
				},
				{
					timeoutMs,
					maxResponseBytes: key === undefined ? 16 * 1024 : 3 * 1024 * 1024
				}
			)
		);
		if (
			performance.now() >= deadline ||
			response.jsonrpc !== '2.0' ||
			response.id !== requestId ||
			response.error !== undefined
		)
			throw new Error('Invalid native provenance RPC response');
		return record(response.result);
	}

	try {
		const network = await call('getNetwork');
		if (
			!networkPassphrase.trim() ||
			network.passphrase !== networkPassphrase ||
			!positiveUint32(network.protocolVersion)
		)
			throw new Error('Native provenance RPC network identity mismatch');
		let instanceLedger: number | undefined;
		const observation = await readContractCode(
			undefined,
			contractId,
			async (key) => {
				const result = await call('getLedgerEntries', key);
				const ledger = result.latestLedger;
				if (
					!positiveUint32(ledger) ||
					(instanceLedger !== undefined &&
						(ledger < instanceLedger || ledger > instanceLedger + MAX_LEDGER_ADVANCE))
				)
					throw new Error('Native provenance RPC ledger evidence is inconsistent');
				instanceLedger ??= ledger;
				return result;
			}
		);
		if (performance.now() >= deadline)
			throw new Error('Native provenance RPC deadline expired');
		return observation;
	} catch {
		throw new ContractRpcUnavailable('Native provenance RPC evidence is unavailable');
	}
}

function positiveUint32(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 0xffffffff
	);
}
