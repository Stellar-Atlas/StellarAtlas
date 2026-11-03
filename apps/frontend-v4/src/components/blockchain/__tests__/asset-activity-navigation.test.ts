import { jest } from '@jest/globals';
import { HookHarness } from './asset-workspace-hook-harness';
import { withExplorerReturnTo } from '../../../api/explorer-return-context';

const hooks=new HookHarness(),base='https://fixture.invalid';
const asset={id:'native',kind:'native' as const,lastObservedLedger:4096};
const start='/explorer/assets/native?tab=transfers&min_ledger=2&max_ledger=4096&return_to=%2Fexplorer%2Fassets';
let route=new URL(start,base);
let failNext=false;
const request=jest.fn(async(path:string)=>{
	const params=new URL(path,base).searchParams;
	const before=Number(params.get('max_ledger')), after=params.get('after');
	if(after&&failNext)throw new Error('Synthetic continuation unavailable.');
	const closedAt='2026-11-02T00:00:00Z';
	return {transfers:[{id:after?'second':'first',ledgerSequence:before,closedAt,transactionHash:'a'.repeat(64),transactionId:'429496729600',operationId:null,from:null,to:null,toMuxed:null,asset:{id:'native',type:'native',code:'XLM',issuer:null},contractId:'',eventTopic:'transfer',amountRaw:'9007199254740993123',amountScale:7}],limit:25,nextCursor:after?null:'second',watermark:{minimumLedger:Math.max(2,before-2047),maximumLedger:before,observedAt:closedAt,coverage:'ingested-only'},elapsedMilliseconds:1};
});
jest.unstable_mockModule('react',()=>({useEffect:hooks.useEffect,useRef:hooks.useRef,useState:hooks.useState}));
jest.unstable_mockModule('next/navigation',()=>({usePathname:()=>route.pathname,useSearchParams:()=>route.searchParams}));
jest.unstable_mockModule('../../../api/explorer-analytics',()=>({requestExplorerJson:request}));
const {useAssetTransferActivity}=await import('../use-asset-transfer-activity');
const render=()=>hooks.render(()=>useAssetTransferActivity(asset));
const settle=async()=>{render();await new Promise<void>(resolve=>setImmediate(resolve));return render();};
const paths=()=>request.mock.calls.map(([path])=>path);

beforeEach(()=>{
	route=new URL(start,base);failNext=false;request.mockClear();
	Object.defineProperty(globalThis,'window',{configurable:true,value:{
		get location(){return route;},
		history:{pushState:(_state:unknown,_title:string,href:string)=>{route=new URL(href,base);}}
	}});
});
afterEach(()=>{hooks.reset();Reflect.deleteProperty(globalThis,'window');});

it('restores the selected asset window and page on Back, Forward and a fresh transaction return',async()=>{
	const initial=await settle();
	expect(new URL(initial.origin,base).searchParams.get('asset_activity_before')).toBe('4096');
	initial.window(2048);
	const first=await settle(),firstUrl=route.href;
	first.next?.();
	const second=await settle(),secondUrl=route.href;
	expect(second.page?.transfers[0]?.id).toBe('second');
	const transaction=new URL(withExplorerReturnTo('/explorer/transactions/'+'a'.repeat(64)+'?ledger_sequence=2048',second.origin),base);
	const backUrl=transaction.searchParams.get('return_to')!;
	expect(new URL(backUrl,base).searchParams.get('tab')).toBe('transfers');
	expect(new URL(backUrl,base).searchParams.get('max_ledger')).toBe('4096');
	route=new URL(firstUrl);
	expect((await settle()).page?.transfers[0]?.id).toBe('first');
	route=new URL(secondUrl);
	expect((await settle()).page?.transfers[0]?.id).toBe('second');
	hooks.reset();route=new URL(backUrl,base);
	const reloaded=await settle();
	expect(reloaded.page?.transfers[0]?.id).toBe('second');
	expect(reloaded.previous).toBeNull();
	expect(paths().map(path=>{
		const query=new URL(path,base).searchParams;
		return [query.get('asset'),query.get('max_ledger'),query.get('after'),query.get('limit')];
	})).toEqual([['native','4096',null,'25'],['native','2048',null,'25'],['native','2048','second','25'],['native','2048',null,'25'],['native','2048','second','25'],['native','2048','second','25']]);
});

it('keeps a failed shared page distinct from empty and recovers an invalid link without a silent query',async()=>{
	route=new URL(start+'&asset_activity_for=foreign&asset_activity_before=100&asset_activity_after=second',base);
	const invalid=await settle();
	expect(invalid.error).toMatch(/Invalid or unrelated/);
	expect(invalid.page).toBeNull();expect(invalid.retry).toBeNull();expect(paths()).toEqual([]);
	invalid.first();
	const first=await settle();
	failNext=true;
	first.next?.();
	const failed=await settle(),failedHref=route.href;
	expect(failed.error).toBe('Synthetic continuation unavailable.');
	expect(failed.page).toBeNull();expect(failed.next).toBeNull();
	expect(failed.previous).not.toBeNull();
	failed.retry?.();
	const retry=await settle();
	expect(retry.error).toBe(failed.error);expect(route.href).toBe(failedHref);
	expect(paths()[2]).toBe(paths()[1]);
	retry.previous?.();
	expect((await settle()).page?.transfers[0]?.id).toBe('first');
});
