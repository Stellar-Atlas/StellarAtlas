import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import { AssetCatalogue } from '../AssetCatalogue.js';
import { AssetCatalogueSource } from '../AssetCatalogueSource.js';
import { classicAsset,nativeAsset,parseAssetReference } from '../AssetIdentity.js';

const issuer='GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const second='GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const network=Networks.PUBLIC;
const observed=(code:string,address:string,first:number,last:number)=>({...classicAsset(code,address,network),
	firstObservedLedger:first,lastObservedLedger:last,firstObservedAt:'2021-01-25T19:31:33.000000Z',lastObservedAt:'2026-10-12T23:39:12.000000Z'});

describe('asset identity and discovery',()=>{
	let root:string;
	beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'asset-catalogue-test-'));});
	afterEach(async()=>{await rm(root,{recursive:true,force:true});jest.restoreAllMocks();});
	function catalogue() {
		const source=new AssetCatalogueSource(network,{HUBBLE_CLICKHOUSE_URL:'http://127.0.0.1:8123'});
		jest.spyOn(source,'refresh').mockResolvedValue({assets:[observed('USDC',issuer,100,500),observed('USDC',second,1000,64_912_514)],
			watermark:'2026-10-13 01:00:00.000000',maxLedger:64_912_514});
		return {source,catalogue:new AssetCatalogue(source,root,network)};
	}
	it('normalizes both issuer orders and all requested separators',()=>{
		const expected=classicAsset('USDC',issuer,network);
		for(const separator of [':','-','_']) for(const reference of ['USDC'+separator+issuer,issuer+separator+'USDC'])
			expect(parseAssetReference(reference,network)).toEqual(expected);
		expect(parseAssetReference('USDC',network)).toBe('USDC');
		expect(nativeAsset(network).contractId).not.toBe(nativeAsset(Networks.TESTNET).contractId);
	});
	it('finds old asset identities and resolves the same identity by SAC without a warehouse read',async()=>{
		const {source,catalogue:registry}=catalogue();await registry.refresh();
		const old=await registry.search({symbol:'USDC',maxLedger:500,limit:25});
		expect((old.data as {id:string}[]).map(value=>value.id)).toEqual(['USDC:'+issuer]);
		expect(await registry.resolve(classicAsset('USDC',issuer,network).contractId)).toEqual(observed('USDC',issuer,100,500));
		await registry.search({q:'USDC',limit:25});
		expect(source.refresh).toHaveBeenCalledTimes(1);
	});
	it('continues symbol results and rejects a cursor reused with different filters',async()=>{
		const {catalogue:registry}=catalogue();await registry.refresh();
		const first=await registry.search({symbol:'USDC',limit:1});expect(first.nextCursor).toEqual(expect.any(String));
		const next=await registry.search({symbol:'USDC',limit:1,cursor:first.nextCursor as string});
		expect((next.data as {id:string}[])[0]?.id).not.toBe((first.data as {id:string}[])[0]?.id);
		await expect(registry.search({symbol:'EURC',limit:1,cursor:first.nextCursor as string})).rejects.toThrow('Invalid cursor');
	});
	it('keeps microsecond observation dates comparable with user millisecond filters',async()=>{
		const {catalogue:registry}=catalogue();await registry.refresh();
		const page=await registry.search({symbol:'USDC',startTime:'2026-10-12T23:39:12.000Z',limit:25});
		expect((page.data as unknown[]).length).toBe(2);
	});
	it('reloads the durable catalogue after process replacement',async()=>{
		const {catalogue:registry}=catalogue();await registry.refresh();
		const replacement=catalogue();await replacement.catalogue.load();
		expect((await replacement.catalogue.search({symbol:'USDC',limit:25})).data).toHaveLength(2);
		expect(replacement.source.refresh).not.toHaveBeenCalled();
	});
});
