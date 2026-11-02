import { assetActivityPath, parseAssetActivityPage } from '../asset-activity-page';
const asset={id:'native',kind:'native' as const};
const row={id:'100:1',ledgerSequence:100,closedAt:'2026-11-02T00:00:00Z',transactionHash:'a'.repeat(64),transactionId:'429496729600',operationId:null,from:null,to:null,toMuxed:null,asset:{id:'native',type:'native',code:'XLM',issuer:null},contractId:'',eventTopic:'transfer',amountRaw:'9007199254740993123',amountScale:7};
const page={transfers:[row],limit:25,nextCursor:'second',watermark:{minimumLedger:2,maximumLedger:100,observedAt:row.closedAt,coverage:'ingested-only'},elapsedMilliseconds:1};
describe('asset transfer page contract',()=>{
	it('retains the existing 25-row query budget and exact source amount',()=>{
		expect(assetActivityPath(asset,100,null)).toBe('/v1/activity/transfers?limit=25&asset=native&min_ledger=2&max_ledger=100');
		expect(assetActivityPath(asset,undefined,'second')).toBe('/v1/activity/transfers?limit=25&asset=native&after=second');
		expect(parseAssetActivityPage(page,asset,100,null).transfers[0]?.amountRaw).toBe(row.amountRaw);
		const contract={id:'C'+'A'.repeat(55),kind:'contract' as const};
		expect(assetActivityPath(contract,100,null)).toContain('contract_id='+contract.id);
		expect(parseAssetActivityPage({...page,transfers:[{...row,contractId:contract.id,asset:{...row.asset,id:contract.id,type:'contract'},amountScale:null}]},contract,100,null).transfers).toHaveLength(1);
	});
	it('rejects foreign asset/window, oversized/malformed/repeated cursor, guessed scale and duplicate rows',()=>{
		for(const value of [{...page,limit:100},{...page,transfers:Array(26).fill(row)},{...page,transfers:[row,row]},{...page,nextCursor:'x'.repeat(2049)},{...page,watermark:{...page.watermark,minimumLedger:1}},{...page,watermark:{...page.watermark,maximumLedger:101}},{...page,watermark:{...page.watermark,coverage:'complete'}},...[{asset:{...row.asset,id:'other'}},{amountScale:6},{amountRaw:'1.5'},{ledgerSequence:101}].map(change=>({...page,transfers:[{...row,...change}]}))]) expect(()=>parseAssetActivityPage(value,asset,100,null)).toThrow();
		expect(()=>parseAssetActivityPage(page,asset,100,'second')).toThrow();
	});
	it('keeps empty partial data distinct from unavailable data',()=>{
		expect(parseAssetActivityPage({...page,transfers:[],nextCursor:null},asset,100,null).transfers).toEqual([]);
		expect(()=>parseAssetActivityPage({error:'Unavailable'},asset,100,null)).toThrow();
	});
});
