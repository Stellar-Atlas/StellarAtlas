const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const test = require('node:test');
const vm = require('node:vm');

const modulePath = process.env.ATLAS_VERIFIER_MODULE_PATH ?? path.resolve(__dirname, '../lib/use-cases/verify-archive-objects/VerifyArchiveObjects.js');

const ok = (value) => ({ value, isErr: () => false });
const err = (error) => ({ error, isErr: () => true });

async function promptly(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Completion blocked on telemetry')), 750);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadCandidate({ httpService = {}, bucketCache = {}, verifyBucketHash = () => ok() } = {}) {
  const progress = [];
  let flushCalls = 0;
  let categoryComplete;
  const pendingFlush = new Promise(() => {});
  class Telemetry {
    updateProgress(...args) { progress.push(args); }
    updateProgressAndFlush(...args) {
      flushCalls += 1;
      this.updateProgress(...args);
      return pendingFlush;
    }
  }
  class CategoryVerifier {
    constructor(_http, _coordinator, _validator, _exceptions, _workers, _progress, completed) {
      categoryComplete = completed;
    }
  }
  class Stub {}
  const mocks = {
    inversify: { inject: () => () => {}, injectable: () => (target) => target },
    neverthrow: { ok, err },
    'http-helper': { Url: { create: (value) => ok(value) } },
    shared: { asyncSleep: async () => {}, mapUnknownToError: (value) => value },
    '../../domain/history-archive/HistoryArchiveStateValidator.js': { HistoryArchiveStateValidator: Stub },
    '../../domain/scanner/BucketCache.js': { BucketCache: Stub },
    '../../infrastructure/di/di-types.js': { TYPES: {} },
    './ArchiveObjectCategoryVerifier.js': { ArchiveObjectCategoryVerifier: CategoryVerifier },
    './ArchiveObjectHistoryStateVerifier.js': { ArchiveObjectHistoryStateVerifier: Stub },
    './ArchiveObjectWorkerTelemetry.js': { ArchiveObjectWorkerTelemetry: Telemetry },
    './ArchiveObjectTerminalQueue.js': { ArchiveObjectTerminalQueue: Stub },
    './CoalescingHistoryArchiveWorkerReporter.js': { CoalescingHistoryArchiveWorkerReporter: Stub },
    './ArchiveObjectHttpContentLength.js': {
      readArchiveObjectContentLength: (headers) => Number(headers['content-length'])
    },
    './ArchiveObjectDownloadCounter.js': {
      createArchiveObjectDownloadCounter: (onBytes, onComplete) => new Transform({
        transform(chunk, _encoding, callback) {
          onBytes(chunk.length);
          callback(null, chunk);
        },
        flush(callback) {
          Promise.resolve().then(onComplete).then(() => callback(), callback);
        }
      })
    },
    './ArchiveObjectWorkerHelpers.js': {
      isReadableArchiveObject: (value) => value instanceof Readable,
      mapArchiveObjectHttpError: (value) => value,
      mapArchiveObjectLocalError: (value) => value,
      verifyBucketHash
    },
    '../../infrastructure/services/HistoryArchiveDownloadPermit.js': { ProcessHistoryArchiveDownloadPermit: Stub },
    './ArchiveObjectFailure.js': {
      archiveAvailabilityFailure: (value) => value,
      archiveEvidenceFailure: (value) => value,
      scannerIssueFailure: (value) => value
    }
  };
  // Evaluate the candidate file unchanged: only its imported dependencies are replaced.
  const candidate = new vm.SourceTextModule(
    await readFile(modulePath, 'utf8'),
    { identifier: modulePath }
  );
  await candidate.link((specifier) => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected import: ${specifier}`);
    const exports = mocks[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    });
  });
  await candidate.evaluate();
  const scanner = new candidate.namespace.VerifyArchiveObjects(
    {}, {}, {}, httpService, {}, bucketCache, { captureException() {} }, {}, 1, 1, {}
  );
  return { scanner, progress, completeCategory: (...args) => categoryComplete(...args), flushCalls: () => flushCalls };
}

test('category download completion enqueues stage and bytes without waiting for telemetry flush', async () => {
  const harness = await loadCandidate();
  await promptly(harness.completeCategory('category-1', 'verifying_ledger', 7, 7));
  assert.deepEqual(harness.progress, [['category-1', 'verifying_ledger', 7, 7]]);
  assert.equal(harness.flushCalls(), 0, 'The never-resolving flush must not be called');
});

test('bucket download releases its permit before verification finishes, with idempotent finally release', async () => {
  const payload = Buffer.from('tiny bucket');
  const hash = createHash('sha256').update(payload).digest('hex');
  const job = { remoteId: 'bucket-1', objectType: 'bucket', bucketHash: hash.toUpperCase(), objectUrl: 'https://unused.invalid/bucket' };
  let releaseAttempts = 0;
  let effectiveReleases = 0;
  let released = false;
  const releasePermit = () => {
    releaseAttempts += 1;
    if (released) return;
    released = true;
    effectiveReleases += 1;
  };
  let reachedVerification;
  const downloaded = new Promise((resolve) => { reachedVerification = resolve; });
  let finishVerification;
  const verificationGate = new Promise((resolve) => { finishVerification = resolve; });
  let hashChecks = 0;
  const harness = await loadCandidate({
    httpService: { get: async () => ok({ data: Readable.from([payload]), status: 200, headers: { 'content-length': String(payload.length) } }) },
    bucketCache: {
      async verifyAndStore(expectedHash, stream, verify) {
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        assert.deepEqual(bytes, payload);
        assert.equal(expectedHash, hash);
        reachedVerification();
        await verificationGate;
        return verify(Readable.from([bytes]));
      }
    },
    async verifyBucketHash(stream, expectedHash) {
      hashChecks += 1;
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), expectedHash.toLowerCase());
      return ok(undefined);
    }
  });
  const verification = harness.scanner.verifyBucket(job, releasePermit);
  try {
    await promptly(downloaded);
    assert.equal(releaseAttempts, 1, 'Completion callback releases before cache/hash verification returns');
    assert.equal(effectiveReleases, 1);
    assert.deepEqual(harness.progress.at(-1), ['bucket-1', 'verifying_bucket', payload.length, payload.length]);
    assert.equal(harness.flushCalls(), 0, 'The never-resolving flush must not be called');
  } finally {
    finishVerification();
  }
  const result = await promptly(verification);
  assert.equal(result.isErr(), false);
  assert.equal(hashChecks, 1);
  assert.equal(result.value.bytesDownloaded, payload.length);
  assert.equal(result.value.workerStage, 'verified');
  assert.deepEqual(result.value.verificationFacts, {
    bucketObject: { expectedBucketHash: hash, hashAlgorithm: 'sha256', matched: true, sourceUrl: job.objectUrl },
    content: { algorithm: 'sha256', digest: hash, representation: 'uncompressed-xdr' }
  });
  assert.deepEqual(harness.progress.at(-1), ['bucket-1', 'verified_bucket', payload.length, payload.length]);
  assert.equal(releaseAttempts, 2, 'Existing finally cleanup still attempts release');
  assert.equal(effectiveReleases, 1, 'The real permit closure contract makes repeated release harmless');
});
