// One initial attempt plus four automatic rechecks; manual exact-ID rechecks
// remain possible after exhaustion. This is not a worker/concurrency limit.
export const historyArchiveInconclusiveMaximumAttempts = 5;

// Share the existing direct-claim even-slot retry lane with broker batches.
export const historyArchiveRetryLaneDivisor = 2;
