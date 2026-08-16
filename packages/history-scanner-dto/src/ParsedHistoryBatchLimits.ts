export const parsedHistoryMaximumBatchRecords = 1_000;

// Worker batches stay comfortably below the API's hard request ceiling. The
// additional headroom permits rolling upgrades from the previous worker and
// keeps body-parser's limit independent from the batching policy.
export const parsedHistoryBatchPayloadLimitBytes = 4 * 1024 * 1024;
export const parsedHistoryRequestBodyLimitBytes = 8 * 1024 * 1024;
