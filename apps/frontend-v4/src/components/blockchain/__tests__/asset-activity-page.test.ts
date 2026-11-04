import { assetActivityHref, assetActivityPath, parseAssetActivityPage, readAssetActivitySelection } from '../asset-activity-page';
import { withExplorerReturnTo } from '../../../api/explorer-return-context';
const asset={id:'native',kind:'native' as const};
const row={id:'100:1',ledgerSequence:100,closedAt:'2026-11-02T00:00:00Z',transactionHash:'a'.repeat(64),transactionId:'429496729600',operationId:null,from:null,to:null,toMuxed:null,asset:{id:'native',type:'native',code:'XLM',issuer:null},contractId:'',eventTopic:'transfer',amountRaw:'9007199254740993123',amountScale:7};
const page={transfers:[row],limit:25,nextCursor:'second',watermark:{minimumLedger:2,maximumLedger:100,observedAt:row.closedAt,coverage:'ingested-only'},elapsedMilliseconds:1};
describe('asset transfer page contract',()=>{
	it('round-trips the selected asset, window and page through a transaction return link',()=>{
		const path='/explorer/assets/native';
		const href=assetActivityHref(path,'tab=transfers&min_ledger=2&max_ledger=100&return_to=%2Fexplorer',asset,{before:100,after:'second'},'#transfers');
		const selected=new URL(href,'https://fixture.invalid');
		expect(selected.hash).toBe('#transfers');
		expect(readAssetActivitySelection(selected.searchParams,{...asset,lastObservedLedger:3000})).toEqual({before:100,after:'second'});
		const transaction=new URL(withExplorerReturnTo('/explorer/transactions/'+row.transactionHash+'?ledger_sequence=100',href),'https://fixture.invalid');
		const back=new URL(transaction.searchParams.get('return_to')!,'https://fixture.invalid');
		expect(transaction.searchParams.get('ledger_sequence')).toBe('100');
		expect(back.pathname).toBe(path);
		expect(back.searchParams.get('tab')).toBe('transfers');
		expect(back.searchParams.get('min_ledger')).toBe('2');
		expect(back.searchParams.get('max_ledger')).toBe('100');
		expect(readAssetActivitySelection(back.searchParams,asset)).toEqual({before:100,after:'second'});
		expect(back.searchParams.has('return_to')).toBe(false);
	});
	it('rejects malformed or foreign page links instead of silently loading the first page',()=>{
		for(const query of ['asset_activity_after=second','asset_activity_for=native','asset_activity_for=foreign&asset_activity_before=100','asset_activity_for=native&asset_activity_before=01','asset_activity_for=native&asset_activity_before=2147483648','asset_activity_for=native&asset_activity_before=100&asset_activity_before=101','asset_activity_for=native&asset_activity_after=a%2Fb']){
			expect(()=>readAssetActivitySelection(new URLSearchParams(query),asset)).toThrow('Invalid or unrelated');
		}
		const shared=new URLSearchParams('asset_activity_for=native&asset_activity_after=second');
		expect(readAssetActivitySelection(shared,{...asset,lastObservedLedger:9000})).toEqual({before:undefined,after:'second'});
	});
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
