import { fixture } from './notice-fixture.mjs';
import { persistentFixture } from './notice-sql-fixture.mjs';
import { noticePolicy } from '../lib/notice-input.mjs';
import { CapturingNoticeSink, dryRunNotices, emptyNoticeState } from '../lib/notice-dry-run.mjs';
import { evaluateOfflineDelivery, OfflineNoticeTransport } from '../lib/notice-delivery-offline.mjs';

// Synthetic inputs through the unchanged monitor, store, reducer and durable adapter.
export async function policyPreview(t) {
  const outage = await fixture(t); outage.primary = false;
  await outage.observe(); const first = await outage.snapshot(); outage.tick();
  await outage.observe(); const second = await outage.snapshot();
  const examples = [outage.sink.captures[0]];
  outage.primary = true; outage.tick(); await outage.observe(); outage.tick(); await outage.observe();
  examples.push(outage.sink.captures[1]);
  const count = outage.sink.captures.length;
  outage.state = JSON.parse(JSON.stringify(outage.state));
  await outage.evaluate(await outage.snapshot()); await outage.evaluate(await outage.snapshot());
  const replay = outage.sink.captures.length - count;

  const freshness = await fixture(t); freshness.data = 'stale';
  for (let minute = 0; minute < 5; minute++) { await freshness.observe(); freshness.tick(); }
  const beforeSustained = freshness.sink.captures.length;
  await freshness.observe(); examples.push(freshness.sink.captures[0]);
  freshness.data = 'ready'; freshness.tick(); await freshness.observe(); freshness.tick(); await freshness.observe();
  examples.push(freshness.sink.captures[1]);

  const transient = await fixture(t); transient.primary = false; await transient.observe();
  transient.primary = true; transient.tick(); await transient.observe(); transient.tick(); await transient.observe();
  const gap = await fixture(t); gap.primary = false; await gap.observe();
  gap.tick(noticePolicy.unknownAfterMs + 1); await gap.observe();
  const afterGap = gap.sink.captures.length;

  const cooldown = await fixture(t); await cooldown.outage(); const acknowledgedAt = cooldown.now;
  cooldown.primary = true; cooldown.tick(); await cooldown.observe(); cooldown.tick(); await cooldown.observe();
  cooldown.primary = false; cooldown.tick(); await cooldown.observe(); cooldown.tick(); await cooldown.observe();
  const priorCount = cooldown.sink.captures.length;
  cooldown.now = acknowledgedAt + noticePolicy.cooldownMs - noticePolicy.sampleIntervalMs;
  await cooldown.observe(); cooldown.tick(); await cooldown.observe();
  const atCooldown = cooldown.sink.captures.length - priorCount;
  cooldown.tick(1); await cooldown.observe();
  const afterCooldown = cooldown.sink.captures.length - priorCount;

  // Untrusted cause extras must not change the canonical automatic payload.
  let state = emptyNoticeState(); const causeSink = new CapturingNoticeSink();
  for (const sample of [first, second]) {
    const input = structuredClone(sample);
    input.recentIncidents[0].cause = 'unverified power or network explanation';
    input.recentIncidents[0].operatorAttribution = 'unverified operator claim';
    const result = await dryRunNotices(state, input, input.lastCheckedAt, causeSink); state = result.state;
  }

  class LostResponse extends OfflineNoticeTransport {
    async send(notice) { await super.send(notice); throw new Error('Simulated lost response'); }
  }
  const monitor = await fixture(t), durable = persistentFixture(t), transport = new LostResponse();
  durable.now = monitor.now; await durable.store.setEnabled(true);
  const evaluate = async () => evaluateOfflineDelivery(durable.store, await monitor.snapshot(), 'f'.repeat(32), transport);
  const observe = async (advance = 0) => {
    monitor.tick(advance); await monitor.observe(); durable.now = monitor.now; return evaluate();
  };
  monitor.primary = false; await observe(); const uncertain = await observe(noticePolicy.sampleIntervalMs);
  await evaluate(); await observe(noticePolicy.sampleIntervalMs);
  monitor.primary = true; await observe(noticePolicy.sampleIntervalMs); await observe(noticePolicy.sampleIntervalMs);
  const durableState = durable.db.raw.prepare('SELECT state FROM notice_delivery').get().state;
  return {examples, causePayload: causeSink.captures[0], suppression: {
    transient: transient.sink.captures.length, beforeSustained, replay, afterGap,
    atCooldown, afterCooldown, uncertain: uncertain.deliveries[0].status,
    durableState, totalSendAttempts: transport.captures.length,
    recoveryAfterUncertain: transport.captures.filter(item => item.kind === 'recovery').length
  }};
}

export function renderPolicyExamples({examples, suppression: s}) {
  const titles = ['Confirmed availability interruption', 'Availability recovery', 'Sustained freshness delay', 'Freshness recovery'];
  const notices = examples.map((notice, index) => `### ${titles[index]}\n\n> ${notice.text}\n\nEvidence: ${notice.evidenceUrl}`).join('\n\n');
  return `These are synthetic offline examples, not reports of actual incidents or deliveries. Each quoted message is the exact canonical reducer payload text.\n\n${notices}\n\n### Cases where another notice is withheld\n\n| Synthetic sequence | Observed offline result |\n| --- | --- |\n| One failed sample, then recovery | ${s.transient} notices, including recovery |\n| Freshness delay sampled for less than five minutes | ${s.beforeSustained} notices |\n| Replay after acknowledgement and state reload | ${s.replay} additional notices |\n| Observation gap longer than three minutes | ${s.afterGap} notices immediately after the gap; confirmation restarts |\n| New confirmed problem exactly fifteen minutes after acknowledgement | ${s.atCooldown} additional problem notices |\n| Same problem one millisecond beyond that boundary | ${s.afterCooldown} additional problem notice |\n| Fake acceptance followed by a lost response | ${s.uncertain}; ${s.totalSendAttempts} total send attempt after replay and recovery samples |\n| Recovery after that uncertain problem | ${s.recoveryAfterUncertain} recovery notices; retained state is ${s.durableState} |`;
}
