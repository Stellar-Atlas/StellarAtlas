import express from 'express';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import { ContractProvenanceService } from '../ContractProvenanceService';
import { contractProvenanceRouter } from '../ContractProvenanceRouter';

const encoder = new TextEncoder();
const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function xdrString(value: string): number[] {
	const bytes = [...encoder.encode(value)];
	const padding = (4 - (bytes.length % 4)) % 4;
	return [0, 0, 0, bytes.length, ...bytes, ...Array(padding).fill(0)];
}

function wasmWithSource(repository: string): Buffer {
	const name = [...encoder.encode('contractmetav0')];
	const body = [
		name.length,
		...name,
		0,
		0,
		0,
		0,
		...xdrString('source_repo'),
		...xdrString(repository)
	];
	return Buffer.from([...header, 0, body.length, ...body]);
}

describe('contract provenance hackathons', () => {
	let upstream: Server;

	beforeEach(() => {
		const prototype = ContractProvenanceService.prototype as unknown as {
			build: () => Promise<unknown>;
		};
		jest
			.spyOn(prototype, 'build')
			.mockResolvedValue({ status: 'not_published', record: null });
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		if (upstream)
			await new Promise<void>((resolve) => upstream.close(() => resolve()));
	});

	async function provenanceFor(repository: string) {
		const id = StrKey.encodeContract(new Uint8Array(32).fill(9));
		const wasm = wasmWithSource(repository);
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
		let calls = 0;
		upstream = createServer((incoming, outgoing) => {
			incoming.resume();
			incoming.on('end', () => {
				const first = calls++ === 0;
				outgoing.setHeader('Content-Type', 'application/json');
				outgoing.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: {
							latestLedger: 150,
							entries: [
								{
									key: (first ? instanceKey : codeKey).toXDR('base64'),
									xdr: (first ? instance : code).toXDR('base64'),
									lastModifiedLedgerSeq: 100
								}
							]
						}
					})
				);
			});
		});
		await new Promise<void>((resolve) =>
			upstream.listen(0, '127.0.0.1', resolve)
		);
		const address = upstream.address();
		if (!address || typeof address === 'string')
			throw new Error('No test listener');
		const app = express().use(
			'/v1',
			contractProvenanceRouter({
				rpcUrl: `http://127.0.0.1:${address.port}`,
				networkPassphrase: 'test'
			})
		);

		return (
			await request(app).get(`/v1/contracts/${id}/provenance`).expect(200)
		).body;
	}

	it('should name the hackathons the source repository took part in', async () => {
		const body = await provenanceFor('github:Ethan-R13N/nest');

		expect(body.metadata.sourceRepository).toBe('Ethan-R13N/nest');
		expect(body.hackathons).toEqual([
			{
				slug: 'hackmeridian-2026',
				name: 'HackMeridian 2026',
				network: 'testnet',
				award: 'first',
				track: null
			}
		]);
	});

	it('should return an empty list for a repository that took part in none', async () => {
		const body = await provenanceFor('github:stellar/rs-soroban-sdk');

		expect(body.hackathons).toEqual([]);
	});

	it('should not change what the build check says', async () => {
		const body = await provenanceFor('github:Ethan-R13N/nest');

		expect(body.build).toEqual({ status: 'not_published', record: null });
		expect(body.securityAudit).toBe('not_assessed');
	});

	it('should name the Stellar Community Fund project of the source repository', async () => {
		const body = await provenanceFor('github:stellar-scaffold/cli');

		expect(body.scfProjects).toEqual([
			expect.objectContaining({ slug: 'scaffold-stellar' })
		]);
	});
});
