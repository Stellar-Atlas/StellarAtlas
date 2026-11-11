import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { runCheck } from '../lib/monitor.mjs';
import { readStatus } from '../lib/store.mjs';
import { CapturingNoticeSink, dryRunNotices, emptyNoticeState } from '../lib/notice-dry-run.mjs';

class D1 {
  raw = new DatabaseSync(':memory:');
  prepare(sql) {
    const raw = this.raw;
    return {sql, args: [], bind(...args) { this.args=args; return this; },
      async run() { return {meta:{changes:Number(raw.prepare(sql).run(...this.args).changes)}}; },
      async all() { return {results:raw.prepare(sql).all(...this.args)}; }};
  }
  async batch(statements) {
    this.raw.exec('BEGIN');
    try {
      const out=[];
      for(const statement of statements) out.push(/^\s*SELECT/.test(statement.sql) ? await statement.all() : await statement.run());
      this.raw.exec('COMMIT'); return out;
    } catch(error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

export async function fixture(t) {
  const DB = new D1(); t.after(() => DB.raw.close());
  for(const file of ['0001_status.sql','0002_incident_details.sql'])
    DB.raw.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const f = {DB, now: Date.parse('2026-11-02T12:00:00.123Z'), state: emptyNoticeState(), sink: new CapturingNoticeSink(), requests: [],
    primary: true, data: 'ready', fallback: true, archiveStale: false};
  f.tick = (ms=60_000) => {f.now+=ms;};
  f.snapshot = () => readStatus(DB,f.now);
  f.evaluate = async (snapshot,now=f.now) => {
    const result = await dryRunNotices(f.state,snapshot,now,f.sink); f.state=result.state; return result;
  };
  f.observe = async () => {
    const env = {DB, MIRROR:{get:async()=>({size:100,json:async()=>({capturedAt:new Date(f.now).toISOString()})})}};
    const options = {clock:()=>f.now,fetchImpl:async(url,init)=>{
      f.requests.push({url,method:init.method});
      if(url.includes('__failover/status')) return Response.json({available:f.primary});
      if(url.includes('workers.dev')) return Response.json({knownNodes:1,archiveRoots:1,explorer:{available:f.fallback}});
      const body = {generatedAt:new Date(f.now).toISOString(),checks:{clickhouse:{status:f.data === 'unavailable' ? 'unavailable' : 'ready'},
        publication:{status:f.data === 'stale' ? 'stale' : 'ready',latestCompletedAt:new Date(f.now-3_600_000).toISOString()},
        archive:{status:f.archiveStale?'stale':'ready'}}};
      return Response.json(body,{status:f.archiveStale?503:200});
    }};
    const result=await runCheck(env,options);
    if(!result.checked) throw Error('Fixture monitor failed to commit');
    return f.evaluate(await f.snapshot());
  };
  f.outage = async () => {f.primary=false;await f.observe();f.tick();return f.observe();};
  return f;
}
