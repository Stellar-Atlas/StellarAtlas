import { Address, xdr } from '@stellar/stellar-sdk';
import { fetchProvenanceJson } from './BoundedProvenanceJson.js';
import { record } from './ContractBuildAttestation.js';

export interface ContractCodeObservation {
	readonly ledger: number;
	readonly modifiedLedger: number;
	readonly wasmSha256: string | null;
	readonly wasm: Uint8Array | null;
	readonly executable: 'wasm' | 'stellar_asset' | 'not_found';
}

export class ContractRpcUnavailable extends Error {}

export async function readContractCode(
	rpcUrl: URL,
	contractId: string
): Promise<ContractCodeObservation> {
	const instanceKey = xdr.LedgerKey.contractData(
		new xdr.LedgerKeyContractData({
			contract: new Address(contractId).toScAddress(),
			key: xdr.ScVal.scvLedgerKeyContractInstance(),
			durability: xdr.ContractDataDurability.persistent
		})
	);
	const instance = await readEntry(rpcUrl, instanceKey);
	if (!instance.entry)
		return {
			ledger: instance.ledger,
			modifiedLedger: 0,
			executable: 'not_found',
			wasmSha256: null,
			wasm: null
		};
	const decodedInstance = xdr.LedgerEntryData.fromXDR(instance.entry, 'base64');
	if (decodedInstance.type !== 'contractData')
		throw new Error('RPC entry is not contract data');
	const data = decodedInstance.contractData;
	if (
		data.contract.toXDR('base64') !==
			instanceKey.contractData.contract.toXDR('base64') ||
		data.key.toXDR('base64') !== instanceKey.contractData.key.toXDR('base64')
	)
		throw new Error('RPC contract instance identity mismatch');
	if (data.val.type !== 'scvContractInstance')
		throw new Error('RPC entry is not a contract instance');
	const executable = data.val.instance.executable;
	if (executable.type === 'contractExecutableStellarAsset')
		return {
			ledger: instance.ledger,
			modifiedLedger: instance.modifiedLedger,
			executable: 'stellar_asset',
			wasmSha256: null,
			wasm: null
		};
	if (executable.type !== 'contractExecutableWasm')
		throw new ContractRpcUnavailable('Unsupported contract executable');
	const hash = executable.wasmHash;
	const code = await readEntry(
		rpcUrl,
		xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash }))
	);
	if (!code.entry)
		throw new ContractRpcUnavailable('Contract Wasm is not available from RPC');
	const decodedCode = xdr.LedgerEntryData.fromXDR(code.entry, 'base64');
	if (decodedCode.type !== 'contractCode')
		throw new Error('RPC entry is not contract code');
	const wasm = decodedCode.contractCode;
	if (wasm.hash.toString() !== hash.toString())
		throw new Error('RPC Wasm identity mismatch');
	return {
		ledger: instance.ledger,
		modifiedLedger: instance.modifiedLedger,
		executable: 'wasm',
		wasmSha256: hash.toString(),
		wasm: wasm.code
	};
}

async function readEntry(
	rpcUrl: URL,
	key: xdr.LedgerKey
): Promise<{ ledger: number; modifiedLedger: number; entry: string | null }> {
	const response = record(
		await fetchProvenanceJson(rpcUrl, {
			jsonrpc: '2.0',
			id: 1,
			method: 'getLedgerEntries',
			params: { keys: [key.toXDR('base64')] }
		})
	);
	if (response.error !== undefined)
		throw new ContractRpcUnavailable(
			'RPC ledger entries are temporarily unavailable'
		);
	const result = record(response.result);
	const ledger = Number(result.latestLedger);
	if (
		!Number.isSafeInteger(ledger) ||
		ledger <= 0 ||
		!Array.isArray(result.entries) ||
		result.entries.length > 1
	)
		throw new ContractRpcUnavailable('RPC ledger-entry response is invalid');
	if (!result.entries.length) return { ledger, modifiedLedger: 0, entry: null };
	const entry = record(result.entries[0]);
	const modifiedLedger = Number(entry.lastModifiedLedgerSeq);
	if (
		entry.key !== key.toXDR('base64') ||
		typeof entry.xdr !== 'string' ||
		entry.xdr.length > 3 * 1024 * 1024 ||
		!Number.isSafeInteger(modifiedLedger) ||
		modifiedLedger < 1 ||
		modifiedLedger > ledger
	)
		throw new ContractRpcUnavailable('RPC ledger-entry evidence is invalid');
	return { ledger, modifiedLedger, entry: entry.xdr };
}
