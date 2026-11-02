import { parseTransactionTransfers, transactionTransferLocationMatches, transactionTransferPath } from '../transaction-transfers';
import { formatTransferAmount } from '../transfer-activity';
const scope = {hash:'a'.repeat(64),ledger:'100'};
const row = {id:'100:1',ledgerSequence:100,closedAt:'2026-11-02T00:00:00Z',transactionHash:scope.hash,transactionId:'429496729600',operationId:null,from:null,to:null,toMuxed:null,asset:{id:'native',type:'native',code:'XLM',issuer:null},contractId:'',eventTopic:'transfer',amountRaw:'9007199254740993123',amountScale:7};
const page = {transfers:[row],limit:25,nextCursor:'next_page',watermark:{minimumLedger:100,maximumLedger:100,observedAt:'2026-11-02T00:00:00Z',coverage:'ingested-only'},elapsedMilliseconds:2};
describe('bounded transaction transfers',()=>{
	it('uses only the resolved transaction and single ledger; preserves exact source amounts',()=>{
		expect(transactionTransferPath(scope,null)).toBe('/v1/activity/transfers?transaction_hash='+scope.hash+'&min_ledger=100&max_ledger=100&limit=25');
		expect(transactionTransferPath(scope,'next_page')).toContain('&after=next_page');
		expect(parseTransactionTransfers(page,scope,null).transfers[0]?.amountRaw).toBe(row.amountRaw);
		expect(formatTransferAmount(row.amountRaw,7)).toBe('900719925474.0993123');
		const contract={...row,id:'100:2',asset:{id:'C'+'A'.repeat(55),type:'contract',code:null,issuer:null},amountScale:null};
		expect(parseTransactionTransfers({...page,transfers:[row,contract]},scope,null).transfers).toHaveLength(2);
		expect(formatTransferAmount(contract.amountRaw,null)).toBe(contract.amountRaw+' raw units');
	});
	it('accepts only bounded scope, pages, i128 values, source scales and scoped cursors',()=>{
		for(const value of [{...page,limit:100},{...page,transfers:Array(26).fill(row)},{...page,nextCursor:'x'.repeat(2049)},{...page,nextCursor:'next_page',transfers:[]},{...page,transfers:[row,row]},...[
			{ledgerSequence:101},{transactionHash:'b'.repeat(64)},{amountRaw:'1.5'},{amountRaw:'170141183460469231731687303715884105728'}, {amountScale:6},{amountScale:NaN},{amountRaw:'-0'}
		].map(change=>({...page,transfers:[{...row,...change}]}))]) expect(()=>parseTransactionTransfers(value,scope,null)).toThrow();
		expect(()=>parseTransactionTransfers(page,scope,'next_page')).toThrow();
		for(const ledger of ['','0','01','2147483648','1e2']) expect(()=>transactionTransferPath({...scope,ledger},null)).toThrow();
	});
	it('distinguishes empty ingested-only pages and a ledger beyond publication',()=>{
		expect(parseTransactionTransfers({...page,transfers:[],nextCursor:null},scope,null).watermark.coverage).toBe('ingested-only');
		expect(parseTransactionTransfers({...page,transfers:[],nextCursor:null,watermark:{...page.watermark,maximumLedger:99}},scope,null).watermark.maximumLedger).toBe(99);
		expect(()=>parseTransactionTransfers({...page,watermark:{...page.watermark,coverage:'complete'}},scope,null)).toThrow();
	});
	it('rejects late success/error context before React rerenders, without coupling other relation cursors',()=>{
		const path='/explorer/transactions/'+scope.hash;
		expect(transactionTransferLocationMatches(scope,path,'')).toBe(true);
		expect(transactionTransferLocationMatches(scope,path,'?ledger_sequence=100&operations_after=other')).toBe(true);
		for(const query of ['?ledger_sequence=101','?ledger_sequence=100&ledger_sequence=101','?ledger_sequence=oops']) expect(transactionTransferLocationMatches(scope,path,query)).toBe(false);
		expect(transactionTransferLocationMatches(scope,'/explorer/transactions/'+'b'.repeat(64),'?ledger_sequence=100')).toBe(false);
	});
});
