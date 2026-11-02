import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {segmentsFor, gradient} from '../public/history.mjs';
import {runCheck, authorized} from '../lib/monitor.mjs';
import {acquireLease, commitCheck, readStatus} from '../lib/store.mjs';

class D1 {
  raw = new DatabaseSync(':memory:');
  prepare(sql) {
    const db = this.raw;
    const statement = {args: [], bind(...args) { this.args = args; return this; },
      async run() { const r = db.prepare(sql).run(...this.args); return {meta:{changes:Number(r.changes)}}; },
      async all() { return {results:db.prepare(sql).all(...this.args)}; }, sql};
    return statement;
  }
  async batch(statements) {
    this.raw.exec('BEGIN');
    try { const out=[];for(const s of statements)out.push(/^\s*SELECT/.test(s.sql)?await s.all():await s.run());this.raw.exec('COMMIT');return out; }
    catch(error){this.raw.exec('ROLLBACK');throw error;}
  }
}
async function fixture() {
  const DB = new D1();
  for (const file of ['0001_status.sql', '0002_incident_details.sql']) {
    DB.raw.exec(await readFile(new URL('../migrations/' + file,import.meta.url),'utf8'));
  }
  let now=Date.parse('2026-10-31T05:00:00.000Z'), down=false;
  const env={DB,MIRROR:{get:async()=>({size:100,json:async()=>({capturedAt:'2026-10-31T04:00:00.000Z'})})}};
  const options={clock:()=>now,fetchImpl:async(url,init)=>{
    assert.equal(init.redirect, 'manual');
    if(String(url).includes('workers.dev'))return Response.json({knownNodes:94,archiveRoots:91,explorer:{available:true}});
    if(String(url).includes('__failover/status'))return Response.json({available:!down});
    return down?new Response(null,{status:502}):Response.json({status:'ready',generatedAt:new Date(now).toISOString(),checks:{clickhouse:{status:'ready'},publication:{status:'ready'}}});
  }};
  return {env,options,tick:()=>{now+=60000;},down:value=>{down=value;},now:()=>now};
}

test('checks record only downtime intervals and preserve unknown data status',async()=>{
  const f=await fixture();
  assert.equal((await runCheck(f.env,f.options)).checked,true);
  let s=await readStatus(f.env.DB,f.now());assert.equal(s.recentIncidents.length,0);assert.equal(s.components.every(x=>x.state==='operational'),true);
  f.tick();f.down(true);await runCheck(f.env,f.options);s=await readStatus(f.env.DB,f.now());
  assert.equal(s.recentIncidents.length,1);assert.equal(s.recentIncidents[0].component,'primary');assert.equal(s.components.find(x=>x.id==='data').state,'unknown');
  f.tick();await runCheck(f.env,f.options);assert.equal((await readStatus(f.env.DB,f.now())).recentIncidents.length,1);
  f.tick();f.down(false);await runCheck(f.env,f.options);s=await readStatus(f.env.DB,f.now());
  assert.equal(s.recentIncidents.length,1);assert.equal(s.recentIncidents[0].endedAt,f.now());
  assert.doesNotMatch(JSON.stringify(s),/token|192\.168|postgres|virtual machine/i);
});
test('expired lease cannot overwrite a newer check',async()=>{
  const f=await fixture(),now=f.now();assert.equal(await acquireLease(f.env.DB,now,'first',1),true);
  assert.equal(await acquireLease(f.env.DB,now+2,'second'),true);
  const observations=['primary','data','failover'].map(id=>({id,state:'operational',reasonCode:'ok'}));
  assert.equal(await commitCheck(f.env.DB,observations,now+3,'first'),false);
  assert.equal(await commitCheck(f.env.DB,observations,now+3,'second'),true);
});
test('internal check authorization is never public',async()=>{
  const secret='a'.repeat(64);
  assert.equal(await authorized(new Request('https://status.example/api/internal/check'),secret),false);
  assert.equal(await authorized(new Request('https://status.example/api/internal/check',{headers:{authorization:'Bearer '+secret}}),secret),true);
});
test('unready data is degraded without inventing a primary outage',async()=>{
  const f=await fixture(),original=f.options.fetchImpl;
  f.options.fetchImpl=(url,init)=>String(url).includes('public-goods')?Response.json({status:'unavailable'},{status:503}):original(url,init);
  await runCheck(f.env,f.options);const s=await readStatus(f.env.DB,f.now());
  assert.equal(s.components.find(x=>x.id==='primary').state,'operational');assert.equal(s.recentIncidents[0].component,'data');
});
test('history includes cutoff overlaps and marks overflow incomplete',async()=>{
  const f=await fixture(),cutoff=f.now()-90*86400000;
  const insert=f.env.DB.raw.prepare(`INSERT INTO outages
    (component,started_at,ended_at,reason_code) VALUES ('primary',?,?,'origin_unavailable')`);
  insert.run(cutoff-60000,cutoff+60000);
  insert.run(cutoff-120000,cutoff-1);
  let s=await readStatus(f.env.DB,f.now());
  assert.equal(s.historyComplete,true);
  assert.equal(s.recentIncidents.length,1);
  assert.equal(s.recentIncidents[0].startedAt,cutoff-60000);
  for(let i=0;i<999;i++)insert.run(f.now()-120000-i,f.now()-60000-i);
  s=await readStatus(f.env.DB,f.now());
  assert.equal(s.historyComplete,true);assert.equal(s.recentIncidents.length,1000);
  insert.run(f.now()-1000,f.now());
  s=await readStatus(f.env.DB,f.now());
  assert.equal(s.historyComplete,false);assert.equal(s.recentIncidents.length,1000);
  const segments=segmentsFor({...s,monitoringSince:cutoff},'primary',cutoff,f.now(),f.now());
  assert.equal(segments.some(item=>item.state==='operational'),false);
  assert.equal(segments.some(item=>item.state==='degraded'),true);
  assert.equal(segments.some(item=>item.state==='unknown'),true);
});

test('a minute interruption occupies only its duration and its own service row',()=>{
  const start=Date.parse('2026-10-31T00:00:00Z'),end=start+86400000;
  const data={monitoringSince:start,lastCheckedAt:end,historyComplete:true,
    recentIncidents:[{component:'data',startedAt:start+3600000,endedAt:start+3660000}]};
  const segments=segmentsFor(data,'data',start,end,end);
  assert.deepEqual(segments.map(item=>[item.state,item.end-item.start]),[
    ['operational',3600000],['degraded',60000],['operational',82740000]]);
  assert.deepEqual(segmentsFor(data,'primary',start,end,end),[{start,end,state:'operational'}]);
  assert.match(gradient(segments,start,end),/var\(--amber\) 4\.16667% 4\.23611%/);
});

test('history leaves pre-monitoring and stale intervals unknown',()=>{
  const data={monitoringSince:1000000,lastCheckedAt:2000000,historyComplete:true,recentIncidents:[]};
  assert.deepEqual(segmentsFor(data,'primary',0,3000000,3000000),[
    {start:0,end:1000000,state:'unknown'},
    {start:1000000,end:2180000,state:'operational'},
    {start:2180000,end:3000000,state:'unknown'}]);
});

