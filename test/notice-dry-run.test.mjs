import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { dryRunNotices, emptyNoticeState } from '../lib/notice-dry-run.mjs';
import { noticePolicy } from '../lib/notice-input.mjs';
import { fixture } from './notice-fixture.mjs';

test('actual monitor/store confirms a sampled outage, with exact timestamps and public links',async t=>{
  const f=await fixture(t),start=f.now; f.primary=false;
  assert.equal((await f.observe()).captured.length,0);f.tick();
  const {captured}=await f.observe();assert.equal(captured.length,1);
  const notice=captured[0];assert.equal(notice.kind,'outage');
  assert.equal(notice.evidence.sampledStartAt,new Date(start).toISOString());
  assert.equal(notice.evidence.confirmedAt,new Date(f.now).toISOString());
  assert.equal(notice.statusUrl,'https://status.stellaratlas.io/');
  assert.equal(notice.evidenceUrl,'https://status.stellaratlas.io/api/status');
  assert.match(notice.text,/availability checks failing\. Observed .*; confirmed /);
  assert.equal(f.requests.filter(item=>item.url.includes('__failover/status')).length,4);
});

test('one transient failed sample produces neither an outage notice nor orphan recovery',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();f.tick();f.primary=true;
  await f.observe();f.tick();await f.observe();assert.equal(f.sink.captures.length,0);
});

test('deduplication survives disk JSON reload and later identical evaluations',async t=>{
  const f=await fixture(t);await f.outage();
  const dir=await mkdtemp(join(tmpdir(),'notice001-'));
  t.after(()=>{
    if(dirname(dir)!==tmpdir() || !basename(dir).startsWith('notice001-')) throw Error('Unexpected fixture cleanup path');
    return rm(dir,{recursive:true,force:true});
  });
  const file=join(dir,'state.json');await writeFile(file,JSON.stringify(f.state));
  f.state=JSON.parse(await readFile(file,'utf8'));
  const status=await f.snapshot();await f.evaluate(status,f.now+120_000);
  f.tick();await f.observe();assert.equal(f.sink.captures.length,1);
});

test('matching recovery needs two healthy samples and bypasses problem cooldown',async t=>{
  const f=await fixture(t);await f.outage();f.tick();f.primary=true;
  const recoveredAt=f.now;assert.equal((await f.observe()).captured.length,0);f.tick();
  const result=await f.observe();assert.equal(result.captured[0]?.kind,'recovery');
  assert.deepEqual(result.captured[0]?.recovers,['outage']);
  assert.equal(result.captured[0]?.evidence.sampledRecoveryAt,new Date(recoveredAt).toISOString());
  f.tick();await f.observe();assert.equal(f.sink.captures.length,2);
});

test('failed capture retains observed evidence and retries matching equal-time input without cooldown',async t=>{
  const f=await fixture(t);f.sink.failNext=true;await f.outage();
  assert.equal(f.state.acknowledged.length,0);assert.deepEqual(f.state.cooldowns,{});
  const count=f.state.samples.primary.count;
  f.state=JSON.parse(JSON.stringify(f.state));
  const result=await f.evaluate(await f.snapshot());assert.equal(result.captured.length,1);
  assert.equal(f.state.samples.primary.count,count);assert.equal(f.state.acknowledged.length,1);
});

test('failed recovery capture retries without another outage or confirmation increment',async t=>{
  const f=await fixture(t);await f.outage();f.primary=true;f.tick();await f.observe();
  f.tick();f.sink.failNext=true;const result=await f.observe();assert.equal(result.failed.length,1);
  await f.evaluate(await f.snapshot());assert.deepEqual(f.sink.captures.map(item=>item.kind),['outage','recovery']);
});

test('obsolete rejected outage does not send after recovery or create a recovery notice',async t=>{
  const f=await fixture(t);f.sink.failNext=true;await f.outage();f.primary=true;
  f.tick();await f.observe();f.tick();await f.observe();assert.equal(f.sink.captures.length,0);
});

test('older snapshots and stale monitor data cannot advance or reset evidence',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();const older=await f.snapshot();
  f.tick();await f.observe();const at=f.state.observedAt;
  assert.equal((await f.evaluate(older)).skipped,'older_evidence');
  assert.equal((await f.evaluate(await f.snapshot(),f.now+180_001)).skipped,'stale_monitor');
  assert.equal(f.state.observedAt,at);assert.equal(f.sink.captures.length,1);
});

test('equal-time conflicts fail closed until strictly newer samples reconfirm',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();const snapshot=await f.snapshot();
  const contradictory=structuredClone(snapshot);contradictory.components[0].state='unknown';
  assert.equal((await f.evaluate(contradictory)).skipped,'equal_time_conflict');
  assert.equal((await f.evaluate(snapshot)).skipped,'equal_time_conflict');
  f.tick();await f.observe();assert.equal(f.sink.captures.length,0);
  f.tick();await f.observe();assert.equal(f.sink.captures.length,1);
});

test('monitoring gaps restart confirmation instead of implying continuous physical outage',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();f.tick(180_001);await f.observe();
  assert.equal(f.sink.captures.length,0);assert.equal(f.state.samples.primary.count,1);
  f.tick();await f.observe();assert.equal(f.sink.captures.length,1);
});

test('sustained publication freshness delay is distinct from availability and recovers distinctly',async t=>{
  const f=await fixture(t);f.data='stale';
  for(let minute=0;minute<5;minute++){await f.observe();assert.equal(f.sink.captures.length,0);f.tick();}
  await f.observe();assert.equal(f.sink.captures.length,1);
  const notice=f.sink.captures[0];assert.equal(notice.kind,'sustained_freshness');
  assert.match(notice.text,/sustained freshness delay/);assert.doesNotMatch(notice.text,/availability checks failing/);
  f.data='ready';f.tick();await f.observe();f.tick();await f.observe();
  assert.deepEqual(f.sink.captures[1]?.recovers,['sustained_freshness']);
  assert.match(f.sink.captures[1]?.text,/freshness checks recovered/);
});

test('transient archive-summary age and composite 503 alone never create an incident notice',async t=>{
  const f=await fixture(t);f.archiveStale=true;
  for(let minute=0;minute<7;minute++){await f.observe();f.tick();}
  assert.equal((await f.snapshot()).recentIncidents.length,0);assert.equal(f.sink.captures.length,0);
});

test('explicit archive detail cannot be relabeled as an outage or freshness notice',async t=>{
  const f=await fixture(t);f.data='stale';
  for(let minute=0;minute<7;minute++){
    await f.observe();f.state=emptyNoticeState();const snapshot=await f.snapshot();
    snapshot.components.find(item=>item.id==='data').probeDetail={kind:'readiness',check:'archive',status:'stale'};
    await f.evaluate(snapshot);f.tick();
  }
  assert.equal(f.sink.captures.length,0);
});

test('inferred and historical incidents do not become confirmed notices',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();
  f.DB.raw.exec("UPDATE outages SET confidence='inferred'");f.tick();await f.observe();
  assert.equal(f.sink.captures.length,0);
  f.DB.raw.exec("UPDATE outages SET confidence='confirmed',source='cloudflare-inferred'");f.tick();await f.observe();
  assert.equal(f.sink.captures.length,0);
});

test('historical closed incidents cannot bootstrap orphan recovery notices',async t=>{
  const f=await fixture(t);await f.outage();f.state=emptyNoticeState();f.primary=true;
  f.tick();await f.observe();f.tick();await f.observe();assert.equal(f.sink.captures.length,1);
});

test('reused incident ID with a different sampled start cannot borrow an old acknowledgement',async t=>{
  const f=await fixture(t);await f.outage();const prior=f.sink.captures[0];
  f.DB.raw.exec('DELETE FROM outages');f.tick();await f.observe();
  assert.equal((await f.snapshot()).recentIncidents[0].id,prior.incidentId);
  f.primary=true;f.tick();await f.observe();f.tick();await f.observe();
  assert.equal(f.sink.captures.length,1);
});

test('one sampled incident can recover both previously captured problem kinds honestly',async t=>{
  const f=await fixture(t);f.data='unavailable';await f.observe();f.tick();await f.observe();
  f.data='stale';
  for(let minute=0;minute<=5;minute++){f.tick();await f.observe();}
  assert.deepEqual(f.sink.captures.map(item=>item.kind),['outage','sustained_freshness']);
  f.data='ready';f.tick();await f.observe();f.tick();await f.observe();
  assert.deepEqual(f.sink.captures[2]?.recovers,['outage','sustained_freshness']);
  assert.match(f.sink.captures[2]?.text,/availability and freshness checks recovered/);
});

test('new incident IDs respect cooldown while recovery remains eligible',async t=>{
  const f=await fixture(t);await f.outage();const firstKey=f.sink.captures[0].key,ackAt=f.now;
  f.primary=true;f.tick();await f.observe();f.tick();await f.observe();
  f.primary=false;f.tick();await f.observe();f.tick();await f.observe();assert.equal(f.sink.captures.length,2);
  f.now=ackAt+noticePolicy.cooldownMs-60_000;await f.observe();
  f.tick();await f.observe();assert.equal(f.sink.captures.length,2);
  f.tick(1);await f.observe();assert.equal(f.sink.captures.length,3);
  assert.notEqual(f.sink.captures[2].key,firstKey);
});

test('unknown samples break confirmation, including otherwise fresh monitor snapshots',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();f.tick();
  const snapshot=await f.snapshot();snapshot.lastCheckedAt=f.now;snapshot.components[0].checkedAt=f.now;snapshot.components[0].state='unknown';
  await f.evaluate(snapshot);f.tick();await f.observe();assert.equal(f.sink.captures.length,0);
  f.tick();await f.observe();assert.equal(f.sink.captures.length,1);
});

test('distinct components can emit bounded independent notices',async t=>{
  const f=await fixture(t);f.primary=false;f.fallback=false;await f.observe();f.tick();await f.observe();
  assert.deepEqual(f.sink.captures.map(item=>item.component),['primary','failover']);
});

test('input, acknowledgement and sink bounds fail closed',async t=>{
  const f=await fixture(t);await f.observe();const snapshot=await f.snapshot();
  await assert.rejects(f.evaluate({...snapshot,historyComplete:false}),/Incomplete/);
  await assert.rejects(f.evaluate({...snapshot,recentIncidents:Array(1001).fill({})}),/Incomplete/);
  const state=emptyNoticeState();state.acknowledged=Array(2001).fill({});
  await assert.rejects(dryRunNotices(state,snapshot,f.now,f.sink),/state/);
  await assert.rejects(dryRunNotices(f.state,snapshot,f.now,{capture(){throw Error('Must not run');}}),/Capturing-only/);
  f.sink.captures=Array(100).fill({});await assert.rejects(f.sink.capture({}),/bound/);
});

test('fixed rendering excludes private causes, raw evidence and arbitrary links',async t=>{
  const f=await fixture(t);f.primary=false;await f.observe();f.tick();
  await f.observe();const snapshot=await f.snapshot();f.state.acknowledged=[];f.state.cooldowns={};
  snapshot.recentIncidents[0].cause={summary:'PRIVATE_RAW_TOKEN',evidenceRef:'https://private.invalid?secret=PRIVATE_RAW_TOKEN'};
  snapshot.recentIncidents[0].statusUrl='https://private.invalid';
  await f.evaluate(snapshot);
  assert.doesNotMatch(JSON.stringify(f.sink.captures),/PRIVATE_RAW_TOKEN|private.invalid/);
  assert.ok(f.requests.every(item=>item.method==='GET')); // These are fake probe calls, never posts.
});

test('all three draft notice forms fit 280 plain characters while retaining UTC metadata',async t=>{
  const f=await fixture(t);await f.outage();f.primary=true;f.tick();await f.observe();f.tick();await f.observe();
  f.data='stale';for(let i=0;i<=5;i++){f.tick();await f.observe();}
  assert.deepEqual(new Set(f.sink.captures.map(item=>item.kind)),new Set(['outage','recovery','sustained_freshness']));
  for(const notice of f.sink.captures){assert.ok(notice.text.length<=280);assert.match(notice.evidence.confirmedAt,/\.123Z$/);}
});
