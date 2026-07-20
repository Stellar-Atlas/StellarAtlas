export const generatedAt = '2026-07-10T12:10:00.000Z';

export function createStatusLivePayload(): Record<string, unknown> {
	return {
		api: { generatedAt, service: 'api', status: 'ok' },
		archiveEvents: {
			count: 1,
			events: [
				{
					archiveUrl: 'https://archive.example',
					archiveUrlIdentity: 'https://archive.example',
					bucketHash: null,
					bytesDownloaded: 1024,
					checkpointLedger: 63,
					claimAttempt: 1,
					createdAt: generatedAt,
					error: null,
					eventType: 'verified',
					evidenceClass: null,
					nextAttemptAt: null,
					objectKey: 'ledger:0000003f',
					objectRemoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
					objectType: 'ledger',
					objectUrl: 'https://archive.example/ledger/file.xdr.gz',
					remoteId: '93a309de-a5df-457b-9412-f267ed5e7388',
					verificationFacts: null,
					workerStage: 'verified_ledger'
				}
			],
			generatedAt,
			limit: 100
		},
		archiveSummary: createArchiveSummary(),
		dataQuality: createDataQuality(),
		frontend: {
			configured: true,
			configurationState: 'configured',
			generatedAt,
			health: 'not_probed',
			probe: 'not_run',
			readiness: 'configured_not_probed',
			requiredForProduction: true,
			service: 'frontend',
			status: 'ok',
			url: 'https://stellaratlas.example'
		},
		fullHistory: {
			canonicalCoverage: {
				archiveSourceCount: 1,
				batchCount: 2,
				firstLedger: '63386240',
				lastLedger: '63386367',
				latestEvidence: {
					archiveUrlIdentity: 'archive.example',
					batchId: '00000000-0000-4000-8000-000000000001',
					checkpointLedger: '63386367',
					checkpointProofId: 41,
					decoderVersion: 'canonical-decoder/1',
					firstLedger: '63386304',
					ingestedAt: generatedAt,
					lastLedger: '63386367',
					proofEvaluatedAt: generatedAt,
					proofVersion: 5,
					sourceObjects: {
						checkpointState: sourceObject('11', '2', 'canonical-json'),
						ledger: sourceObject('22', '3', 'uncompressed-xdr'),
						results: sourceObject('33', '5', 'uncompressed-xdr'),
						transactions: sourceObject('44', '4', 'uncompressed-xdr')
					}
				},
				latestLedgerClosedAt: generatedAt,
				ledgerCount: 128,
				nextLedger: '63386368',
				rangeKind: 'contiguous_bounded',
				source: 'postgres_canonical',
				transactionCount: 52000,
				transactionResultCount: 52000,
				updatedAt: generatedAt
			},
			canonicalPromotion: {
				checkpointLedger: '63386431',
				heartbeatAt: generatedAt,
				lastAttemptAt: generatedAt,
				lastErrorCode: null,
				lastFailureAt: null,
				lastOutcome: 'proof-pending',
				lastSuccessAt: generatedAt,
				nextLedger: '63386368',
				startedAt: generatedAt,
				state: 'waiting-for-proof'
			},
			earliestParsedLedger: '1',
			generatedAt,
			historicalBackfill: {
				completedCheckpoints: 182,
				completedJobs: 182,
				currentProof: {
					archiveUrl: 'https://must-not-leak.example',
					checkpointLedger: '63386175',
					expectedBucketCount: 37,
					failedBucketCount: 0,
					failureKind: 'bucket-missing',
					remainingBucketCount: 9,
					status: 'not-evaluable',
					verifiedBucketCount: 28
				},
				failedJobs: 0,
				latestErrorCode: null,
				nextCheckpointLedger: '63386175',
				pendingJobs: 0,
				runningJobs: 0,
				state: 'idle',
				updatedAt: generatedAt
			},
			ledgerCloseMeta: {
				batchCount: 2,
				firstAvailableLedger: '3',
				firstLedger: '3',
				lastLedger: '130',
				ledgerCount: '128',
				nextLedger: '131',
				outputs: [
					{
						batchCount: 1,
						dataset: 'account-state-changes',
						outputBytes: '2048',
						recordCount: '125',
						schemaVersions: [
							'stellar-atlas.full-history.account-state-changes.v1'
						]
					},
					{
						batchCount: 2,
						dataset: 'transactions',
						outputBytes: '4096',
						recordCount: '250',
						schemaVersions: ['3']
					},
					{
						batchCount: 1,
						dataset: 'trustline-state-changes',
						outputBytes: '1024',
						recordCount: '75',
						schemaVersions: [
							'stellar-atlas.full-history.trustline-state-changes.v1'
						]
					}
				],
				sourceCount: 1,
				updatedAt: generatedAt
			},
			ledgerCloseMetaState: {
				canonicalLinkage: {
					expectedLedgerCount: '128',
					latestCompletedAt: generatedAt,
					latestUpdatedAt: generatedAt,
					lifecycle: {
						checking: 0,
						complete: 2,
						failed: 0,
						pending: 0,
						total: 2
					},
					matchedLedgerCount: '128'
				},
				imports: {
					datasets: [
						{
							dataset: 'account-state-changes',
							latestCompletedAt: generatedAt,
							latestUpdatedAt: generatedAt,
							lifecycle: {
								complete: 2,
								failed: 0,
								importing: 0,
								pending: 0,
								total: 2
							}
						},
						{
							dataset: 'trustline-state-changes',
							latestCompletedAt: generatedAt,
							latestUpdatedAt: generatedAt,
							lifecycle: {
								complete: 2,
								failed: 0,
								importing: 0,
								pending: 0,
								total: 2
							}
						}
					],
					latestCompletedAt: generatedAt,
					latestUpdatedAt: generatedAt,
					lifecycle: {
						complete: 4,
						failed: 0,
						importing: 0,
						pending: 0,
						total: 4
					}
				}
			},
			latestObservedAt: generatedAt,
			latestParsedLedger: '63386367',
			localAssetIndexReady: false,
			localContractIndexReady: false,
			localOperationIndexReady: false,
			localTransactionIndexReady: true,
			mode: 'canonical_checkpoint_index',
			parsedLedgerCount: 1000,
			sourceArchiveCount: 75,
			status: 'ok'
		},
		generatedAt,
		scanLogs: createScanLogs(),
		workers: createLegacyWorkers()
	};
}

function sourceObject(
	seed: string,
	suffix: string,
	representation: 'canonical-json' | 'uncompressed-xdr'
) {
	return {
		algorithm: 'sha256',
		contentDigest: seed.repeat(32),
		objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
		representation
	};
}

function createArchiveSummary() {
	return {
		activeObjectChecks: 20,
		archiveEvidenceFailures: 1,
		checkpointCoverage: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 1,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 1,
			categoryConsistentArchiveCheckpoints: 9,
			completeArchiveCheckpoints: 9,
			discoveryCompleteArchiveRoots: 1,
			expectedArchiveCheckpoints: 10,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: 639,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 9,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 10
		},
		generatedAt,
		sourceCount: 1,
		sourceLimit: 256,
		scannerIssueFailures: 0,
		sources: [
			{
				activeObjectChecks: 20,
				archiveEvidenceFailures: 1,
				archiveUrl: 'https://archive.example',
				archiveUrlIdentity: 'https://archive.example',
				currentLedger: 639,
				latestCheckpointLedger: 639,
				latestDiscoveredCheckpointLedger: 639,
				mismatchCheckpointProofs: 0,
				notEvaluableCheckpointProofs: 0,
				objectCompleteCheckpointProofs: 9,
				observedAt: generatedAt,
				pendingCheckpointProofs: 1,
				rootObjectStatus: 'verified',
				rootFailureChannel: null,
				scannerIssueFailures: 0,
				source: 'network-scan',
				stateStatus: 'available',
				stateUrl: 'https://archive.example/.well-known/stellar-history.json',
				totalCheckpointProofs: 10,
				unclassifiedFailures: 0,
				verifiedCheckpointProofs: 9
			}
		],
		sourcesTruncated: false,
		unclassifiedFailures: 0
	};
}

function createDataQuality() {
	const archiveEvidence = {
		ageMs: 1000,
		drivesPlatformStatus: false,
		drivesRuntimeHealth: false,
		latestAt: generatedAt,
		source: 'archive_object_evidence',
		staleAfterMs: 21_600_000,
		status: 'ok'
	};
	return {
		archiveQueue: {
			activeJobs: 20,
			deprecated: true,
			drivesPlatformStatus: false,
			drivesRuntimeHealth: false,
			generatedAt,
			historical: true,
			pendingJobs: 100,
			source: 'legacy_range_scan',
			staleJobAgeMs: 120_000,
			staleJobs: 0,
			status: 'ok',
			totalUnfinishedJobs: 120
		},
		dataFreshness: {
			archiveEvidence,
			archiveScan: {
				ageMs: 345_600_000,
				deprecated: true,
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				historical: true,
				latestAt: '2026-07-06T12:10:00.000Z',
				source: 'legacy_range_scan',
				staleAfterMs: 21_600_000,
				status: 'degraded'
			},
			generatedAt,
			networkScan: {
				ageMs: 1000,
				latestAt: generatedAt,
				staleAfterMs: 600_000,
				status: 'ok'
			},
			status: 'ok'
		},
		generatedAt,
		rollups: {
			generatedAt,
			networkRollups: {
				daysWithCompletedScans: 1,
				daysWithRollups: 1,
				latestRollupDay: generatedAt,
				matchingDays: 1,
				mismatchedRollupDays: 0,
				missingRollupDays: 0,
				rawCompletedScans: 1,
				rollupCrawlCount: 1,
				status: 'ok',
				windowDays: 7,
				windowEnd: generatedAt,
				windowStart: generatedAt
			},
			status: 'ok'
		},
		scans: {
			generatedAt,
			networkScan: {
				completedScans: 1,
				completionRate: 100,
				expectedCompletionRate: 100,
				expectedScans: 1,
				incompleteScans: 0,
				latestCompletedScanAt: generatedAt,
				latestScanAt: generatedAt,
				scanIntervalMs: 180_000,
				status: 'ok',
				totalScans: 1,
				windowEnd: generatedAt,
				windowMs: 86_400_000,
				windowStart: generatedAt
			},
			status: 'ok'
		},
		status: 'ok'
	};
}

function createScanLogs() {
	return {
		archiveScans: [
			{
				concurrency: 1,
				durationMs: 1000,
				endDate: generatedAt,
				errorCount: 0,
				errors: [],
				fromLedger: 63,
				hasArchiveVerificationError: false,
				hasWorkerIssue: false,
				latestScannedLedger: 63,
				latestVerifiedLedger: 63,
				scanStatus: 'ok',
				startDate: generatedAt,
				toLedger: 63,
				url: 'https://archive.example'
			}
		],
		archiveScansDeprecated: true,
		archiveScansHistorical: true,
		generatedAt,
		limit: 25,
		networkScans: [
			{
				archiveScheduling: {
					discoveredArchiveUrlCount: 1,
					duplicateSuppressedArchiveScanJobCount: 0,
					scheduledArchiveScanJobCount: 1,
					schedulerErrorCount: 0
				},
				completed: true,
				latestLedger: '100',
				latestLedgerCloseTime: generatedAt,
				ledgersCount: 100,
				status: 'ok',
				time: generatedAt
			}
		]
	};
}

function createLegacyWorkers() {
	return {
		archiveWorkers: {
			activeWorkers: 20,
			configuredWorkerProcesses: 24,
			staleJobAgeMs: 120_000,
			staleWorkers: 0,
			status: 'degraded',
			totalTakenJobs: 20
		},
		communityScanners: {
			activeScanners: 0,
			blacklistedScanners: 0,
			degradedScanners: 0,
			heartbeatFreshnessMs: 300_000,
			offlineScanners: 0,
			status: 'ok',
			totalScanners: 0
		},
		generatedAt,
		status: 'degraded'
	};
}
