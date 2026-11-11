import test from 'node:test';
import assert from 'node:assert/strict';
import { policyPreview, renderPolicyExamples } from './notice-policy-preview-fixture.mjs';
import { noticePolicy } from '../lib/notice-input.mjs';

test('offline preview renders canonical reducer messages and evidence links', async t => {
  const result = await policyPreview(t);
  const document = renderPolicyExamples(result);
  assert.deepEqual(result.examples.map(item => item.kind), ['outage', 'recovery', 'sustained_freshness', 'recovery']);
  for (const notice of result.examples) {
    assert.ok(document.includes('> ' + notice.text));
    assert.ok(document.includes(notice.evidenceUrl));
    assert.ok(notice.text.length <= 200);
    const observed = notice.kind === 'recovery' ? notice.evidence.sampledRecoveryAt : notice.evidence.sampledStartAt;
    assert.equal(notice.text.split(observed).length - 1, 1);
    assert.ok(notice.text.includes('; confirmed ' + notice.evidence.confirmedAt));
    assert.doesNotMatch(notice.text, /Confirmation:|physical boundaries|power|network cause/);
  }
});

test('offline suppression examples follow actual reducer and durable uncertain-send behavior', async t => {
  const {suppression} = await policyPreview(t);
  assert.deepEqual(suppression, {transient:0, beforeSustained:0, replay:0, afterGap:0,
    atCooldown:0, afterCooldown:1, uncertain:'uncertain', durableState:'uncertain',
    totalSendAttempts:1, recoveryAfterUncertain:0});
  assert.deepEqual([noticePolicy.sampleIntervalMs, noticePolicy.unknownAfterMs,
    noticePolicy.sustainedMs, noticePolicy.cooldownMs], [60_000,180_000,300_000,900_000]);
});

test('automatic preview does not turn cause claims into operator attribution or leak extra fields', async t => {
  const result = await policyPreview(t);
  assert.deepEqual(result.causePayload, result.examples[0]);
  const preview = renderPolicyExamples(result);
  assert.doesNotMatch(preview, /unverified|power|network explanation|operator claim|probeDetail|authorization|Bearer/);
  assert.match(result.examples[2].text, /sustained freshness delay/);
  assert.doesNotMatch(result.examples[2].text, /availability checks failing/);
});
