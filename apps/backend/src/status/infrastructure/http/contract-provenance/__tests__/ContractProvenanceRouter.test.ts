import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import type { fetchRpcJson } from '../BoundedProvenanceJson.js';
import { contractCatalogueRouter } from '../ContractCatalogueRouter.js';
import {
	catalogueCursor, type ContractCatalogueItem, type ContractCatalogueQuery
} from '../ContractCatalogue.js';

const { jest: mocks } = import.meta as ImportMeta & { jest: typeof jest };
const fetchRpc = mocks.fn<
	ReturnType<typeof fetchRpcJson>,
	Parameters<typeof fetchRpcJson>
>();
mocks.unstable_mockModule('../BoundedProvenanceJson.js', () => ({
	fetchRpcJson: fetchRpc,
	fetchGithubAttestations: mocks.fn(),
	ProvenanceHttpError: class extends Error {}
}));
const { contractProvenanceRouter } =
	await import('../ContractProvenanceRouter.js');

it('binds catalogue continuation to the normalized filter and configured network', async () => {
	const contractId = StrKey.encodeContract(new Uint8Array(32).fill(7));
	const item: ContractCatalogueItem = {
		contractId, observedLedger: 150, instanceModifiedLedger: 100,
		checkedAt: '2026-11-09T12:00:00.000Z', wasmSha256: 'a'.repeat(64),
		ledgerEvidence: 'configured_rpc_observation',
		build: {
			status: 'verified',
			record: {
				repository: 'Example/Contract', commit: 'b'.repeat(40),
				sourceUrl: 'https://github.com/Example/Contract/tree/' + 'b'.repeat(40),
				workflowUrl: 'https://github.com/Example/Contract/blob/' + 'b'.repeat(40) + '/.github/workflows/release.yml',
				runUrl: null,
				attestationUrl: 'https://api.github.com/repos/Example/Contract/attestations/sha256:' + 'a'.repeat(64)
			}
		},
		independentReproduction: 'not_assessed', securityAudit: 'not_assessed'
	};
	const list = jest.fn(async (query: ContractCatalogueQuery) => ({
		version: 1 as const, networkPassphrase: 'network one',
		items: query.after ? [] : [item],
		nextCursor: query.after ? null : catalogueCursor(query, item)
	}));
	const route = '/v1/contracts/catalogue';
	const app = express().use('/v1', contractCatalogueRouter('network one', { list }));
	const first = await request(app).get(route).query({ q: 'Example/Con', limit: 1 })
		.expect('Cache-Control', 'no-store').expect(200);
	expect(first.body.items).toEqual([item]);
	const cursor = first.body.nextCursor;
	await request(app).get(route).query({ q: 'example/con', cursor }).expect(200);
	expect(list.mock.calls[1]?.[0].after).toEqual({ contractId, repositoryKey: 'example/contract' });
	await request(app).get(route).query({ q: 'different', cursor }).expect(400);
	await request(app).get(route + '?q=one&q=two').expect(400);
	await request(app).get(route).query({ limit: 51 }).expect(400);
	await request(express().use('/v1', contractCatalogueRouter('network two', { list })))
		.get(route).query({ q: 'example/con', cursor }).expect(400);
	expect(list).toHaveBeenCalledTimes(2);
	expect(fetchRpc).not.toHaveBeenCalled();
});

it('reports catalogue unavailability separately from an available empty page', async () => {
	const route = '/v1/contracts/catalogue';
	const disabled = express().use('/v1', contractCatalogueRouter('test'));
	await request(disabled).get(route).expect('Cache-Control', 'no-store').expect(503);
	const enabled = express().use('/v1', contractCatalogueRouter('test', {
		list: async () => ({ version: 1, networkPassphrase: 'test', items: [], nextCursor: null })
	}));
	await request(enabled).get(route).expect(200)
		.expect({ version: 1, networkPassphrase: 'test', items: [], nextCursor: null });
});

describe('contract provenance RPC path', () => {
	afterEach(() => fetchRpc.mockReset());
	it('reads matching instance and code evidence and caches the bounded result', async () => {
		const id = StrKey.encodeContract(new Uint8Array(32).fill(7));
		const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
		const hash = createHash('sha256').update(wasm).digest('hex');
		const contract = new Address(id).toScAddress();
		const instanceKey = xdr.LedgerKey.contractData(
			new xdr.LedgerKeyContractData({
				contract,
				key: xdr.ScVal.scvLedgerKeyContractInstance(),
				durability: xdr.ContractDataDurability.persistent
			})
		);
		const codeKey = xdr.LedgerKey.contractCode(
			new xdr.LedgerKeyContractCode({ hash })
		);
		const instance = xdr.LedgerEntryData.contractData(
			new xdr.ContractDataEntry({
				ext: xdr.ExtensionPoint.v0(),
				contract,
				key: xdr.ScVal.scvLedgerKeyContractInstance(),
				durability: xdr.ContractDataDurability.persistent,
				val: xdr.ScVal.scvContractInstance(
					new xdr.ScContractInstance({
						executable: xdr.ContractExecutable.contractExecutableWasm(hash),
						storage: null
					})
				)
			})
		);
		const code = xdr.LedgerEntryData.contractCode(
			new xdr.ContractCodeEntry({
				ext: xdr.ContractCodeEntryExt.v0(),
				hash,
				code: wasm
			})
		);
		const endpoint = 'http://127.0.0.1:9000/stellar/rpc';
		function evidence(key: xdr.LedgerKey, entry: xdr.LedgerEntryData) {
			return {
				jsonrpc: '2.0',
				id: 1,
				result: {
					latestLedger: 150,
					entries: [
						{
							key: key.toXDR('base64'),
							xdr: entry.toXDR('base64'),
							lastModifiedLedgerSeq: 100
						}
					]
				}
			};
		}
		fetchRpc
			.mockResolvedValueOnce(evidence(instanceKey, instance))
			.mockResolvedValueOnce(evidence(codeKey, code));
		const app = express().use(
			'/v1',
			contractProvenanceRouter({
				rpcUrl: endpoint,
				approvedNativeRpcUrl: endpoint,
				networkPassphrase: 'test'
			})
		);
		const result = await request(app)
			.get('/v1/contracts/' + id + '/provenance')
			.expect(200);
		expect(result.body).toMatchObject({
			contractId: id,
			observedLedger: 150,
			wasmSha256: hash,
			build: { status: 'metadata_missing', record: null },
			securityAudit: 'not_assessed'
		});
		await request(app)
			.get('/v1/contracts/' + id + '/provenance')
			.expect(200);
		expect(fetchRpc.mock.calls.map(([rpc, body]) => [rpc.href, body])).toEqual(
			[instanceKey, codeKey].map((key) => [
				endpoint,
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'getLedgerEntries',
					params: { keys: [key.toXDR('base64')] }
				}
			])
		);
	});
	it('rejects invalid addresses and returns uncached unavailability when RPC is unconfigured', async () => {
		const app = express().use(
			'/v1',
			contractProvenanceRouter({ networkPassphrase: 'test' })
		);
		await request(app).get('/v1/contracts/bad/provenance').expect(400);
		const response = await request(app)
			.get(
				'/v1/contracts/' +
					StrKey.encodeContract(new Uint8Array(32).fill(1)) +
					'/provenance'
			)
			.expect(503);
		expect(response.headers['cache-control']).toBe('no-store');
	});
});
