import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { Router } from 'express';
import { registerHubbleTransactionRoutes } from '../HubbleTransactionRoutes.js';
import { ClickHouseHubbleWarehouse } from '../HubbleWarehouseClient.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';

const hash = 'a'.repeat(64);
const ledger = 64987266;
const transactionId = String((BigInt(ledger) << 32n) + 4096n);
const closedAt = '2026-09-01 00:00:00';
const parent = {
	record_id: transactionId, transaction_hash: hash, ledger_sequence: ledger, closed_at: closedAt,
	account: 'fixture', record_account_sequence: '1', successful: true, operation_count: 1,
	memo_type: 'none', memo: '', record_fee_charged: '100', record_max_fee: '100', transaction_result_code: 'tx_success'
};
const event = {
	record_transaction_id: transactionId, transaction_hash: hash, ledger_sequence: ledger, closed_at: closedAt,
	record_operation_id: null, contract_id: 'fixture', type: 1, type_string: 'contract', successful: true,
	in_successful_contract_call: true, topics_decoded: [{symbol:'transfer'}], data_decoded: '{}', contract_event_xdr: 'fixture-xdr'
};
const empty = () => Response.json({data:[],rows:0});
const encoder = new TextEncoder();

function setup(fetch: typeof globalThis.fetch) {
	const warehouse = new ClickHouseHubbleWarehouse({endpoint:'http://fixture.invalid:8123', fetch});
	const route = { get(_path: string, handler: (...args: unknown[]) => Promise<void>) { call = handler; } };
	let call: ((...args: unknown[]) => Promise<void>) | undefined;
	registerHubbleTransactionRoutes(route as unknown as Router, warehouse);
	assert.ok(call);
	return {warehouse, call};
}

function request() {
	const req = Object.assign(new EventEmitter(), {aborted:false, query:{view:'typed', ledger_sequence:String(ledger)}, params:{transactionHash:hash}});
	const res = Object.assign(new EventEmitter(), {
		destroyed:false, writableEnded:false, statusCode:0, value:undefined as unknown,
		headers:new Map<string,string>(),
		setHeader(key:string, value:string) { this.headers.set(key,value); },
		status(code:number) { this.statusCode=code; return this; },
		json(value:unknown) { this.value=value; this.writableEnded=true; }
	});
	return {req,res};
}

async function captureErrorLog(run: () => Promise<void>) {
	let output = '';
	const sink = new Writable({write(chunk, _encoding, done) { output += chunk.toString(); done(); }});
	const formatted = new Console({stdout:sink, stderr:sink, colorMode:false});
	const original = console.error;
	console.error = (...values: unknown[]) => { formatted.error(...values); };
	try { await run(); } finally { console.error=original; }
	return output;
}

test('truncated stream after a valid-looking prefix, malformed JSON and ordinary upstream failure are 503/no-store', async () => {
	for (const response of [
		() => {
			let pulls=0;
			return new Response(new ReadableStream<Uint8Array>({pull(stream) {
				if(pulls++ === 0) stream.enqueue(encoder.encode('{"data":[],"rows":0}'));
				else stream.error(new TypeError('incomplete chunked body'));
			}}));
		},
		() => new Response('{"data":[{"secret":"synthetic-raw-error"'),
		() => new Response('synthetic-raw-error', {status:500, headers:{'x-clickhouse-exception-code':'158'}})
	]) {
		const {call}=setup(async()=>response());
		const {req,res}=request();
		const log=await captureErrorLog(()=>call(req,res));
		assert.equal(res.statusCode,503);
		assert.equal(res.headers.get('Cache-Control'),'no-store');
		assert.equal((res.value as {code:string}).code,'hubble_warehouse_unavailable');
		assert.doesNotMatch(log,/synthetic-raw-error/);
	}
});

test('fetch and body failures log only fixed diagnostics with real Node console formatting', async () => {
	const cases = [
		{
			fetch: async () => { throw new HubbleWarehouseUnavailableError('synthetic-fetch-marker', {
				cause: new Error('synthetic-fetch-cause')
			}); },
			expected: /ClickHouse request failed/
		},
		{
			fetch: async () => new Response(new ReadableStream<Uint8Array>({pull(stream) {
				stream.error(new TypeError('synthetic-body-marker', {cause:new Error('synthetic-body-cause')}));
			}})),
			expected: /ClickHouse response body read failed \(HTTP 200\)/
		}
	];
	for(const {fetch,expected} of cases) {
		const {call}=setup(fetch);
		const {req,res}=request();
		const log=await captureErrorLog(()=>call(req,res));
		assert.equal(res.statusCode,503);
		assert.equal(res.headers.get('Cache-Control'),'no-store');
		assert.doesNotMatch(log,/synthetic-(?:fetch|body)-(?:marker|cause)/);
		assert.match(log,expected);
	}
});

test('HTTP 200 exception must not turn into a false 404 or a cached empty parent', async () => {
	for (const failure of [
		() => Response.json({data:[],rows:0,exception:'synthetic-raw-error'}),
		() => Response.json({data:[],rows:0},{headers:{'x-clickhouse-exception-code':'241'}}),
		() => Response.json({data:[],rows:1})
	]) {
		let calls=0;
		const {call}=setup(async()=>++calls===1?failure():empty());
		const first=request(), next=request();
		await captureErrorLog(()=>call(first.req,first.res));
		await call(next.req,next.res);
		assert.equal(first.res.statusCode,503);
		assert.equal(next.res.statusCode,404);
		assert.equal(calls,2);
	}
});

test('classification errors cannot become a partially successful typed transaction', async () => {
	for (const payload of [{exception:'failure'}, {data:[{kind:'transaction'}],exception:'failure'}, {}]) {
		let stages=0, classificationReads=0;
		const {call}=setup(async resource=>{
			stages++;
			const sql=new URL(String(resource)).searchParams.get('query')!;
			if(sql.includes("SELECT 'transaction' AS kind"))return ++classificationReads===1 ? Response.json(payload) : empty();
			if(sql.includes('.history_transactions'))return Response.json({data:[parent],rows:1});
			if(sql.includes('.history_contract_events'))return Response.json({data:[event],rows:1});
			return empty();
		});
		const {req,res}=request();
		await captureErrorLog(()=>call(req,res));
		assert.equal(stages,5);
		assert.equal(res.statusCode,503);
		assert.equal(res.headers.get('Cache-Control'),'no-store');
		const next=request();
		await call(next.req,next.res);
		assert.equal(next.res.statusCode,200);
		assert.equal((next.res.value as {events:{items:unknown[]}}).events.items.length,1);
		assert.equal(stages,10);
	}
});

test('downstream close aborts the upstream body and does not write a response', async () => {
	let signal: AbortSignal | undefined;
	let abortBody: (()=>void) | undefined;
	let ready: (()=>void) | undefined;
	const started=new Promise<void>(resolve=>{ready=resolve;});
	const {call}=setup(async (_input,options)=>{
		signal=options?.signal??undefined;
		let pulls=0;
		return new Response(new ReadableStream<Uint8Array>({
			start(stream) {
				abortBody=()=>stream.error(new TypeError('fixture canceled body'));
				signal?.addEventListener('abort',abortBody,{once:true});
			},
			pull(stream) {
				if(pulls++===0) stream.enqueue(encoder.encode('{"data":[],"rows":0}'));
				else ready?.();
			}
		},{highWaterMark:0}));
	});
	const {req,res}=request();
	const pending=call(req,res);
	await started;
	res.destroyed=true;
	res.emit('close');
	if(!signal?.aborted)abortBody?.(); // Baseline fixture must not leave a pending body.
	await captureErrorLog(()=>pending);
	assert.equal(signal?.aborted,true);
	assert.equal(res.statusCode,0);
	assert.equal(req.listenerCount('aborted'),0);
	assert.equal(res.listenerCount('close'),0);
});

test('a failed shared catalog load is not cached as an empty result', async () => {
	let schemaReads=0;
	const {warehouse}=setup(async resource=>{
		const sql=new URL(String(resource)).searchParams.get('query')!;
		if(sql.includes('FROM system.columns')){
			schemaReads++;
			return schemaReads===1?Response.json({data:[],exception:'failure'}):empty();
		}
		if(sql.includes('range_count'))return Response.json({data:[{ranges:[],range_count:'0'}]});
		return empty();
	});
	await assert.rejects(()=>warehouse.catalog(),HubbleWarehouseUnavailableError);
	const second=await warehouse.catalog();
	assert.equal(await warehouse.catalog(),second);
	assert.equal(schemaReads,2);
});
