/** Scheduling metadata only. Epoch microseconds retain PostgreSQL ordering. */
export interface ArchiveBrokerRamCandidate {
	readonly remoteId: string;
	readonly archiveUrlIdentity: string;
	readonly hostIdentity: string;
	readonly objectType: string;
	readonly checkpointLedger: number | null;
	readonly objectOrder: number;
	readonly priority: number;
	readonly status: string;
	readonly attempts: number;
	readonly executionDisposition: string;
	readonly dependencyReady: boolean;
	readonly transitionEffectsRequiredAtUs: string | null;
	readonly transitionEffectsCompletedAtUs: string | null;
	readonly dispatchToken: string | null;
	readonly publishedAtUs: string | null;
	readonly availableAtUs: string;
	readonly updatedAtUs: string;
}

export interface ArchiveBrokerRamControl {
	readonly archiveUrlIdentity: string;
	readonly scope: string;
	readonly blockedUntilUs: string | null;
	readonly probeLeaseUntilUs: string | null;
	readonly unknownCount: number;
	readonly nextProbeCheckpoint: number | null;
}

export interface ArchiveBrokerRamContext {
	readonly databaseNowUs: string;
	readonly canonicalRoot: string | null;
	readonly canonicalIncomplete: boolean;
	readonly controls: readonly ArchiveBrokerRamControl[];
	readonly activeHosts: readonly {
		hostIdentity: string;
		activeCount: number;
	}[];
	readonly activeScopes: readonly {
		archiveUrlIdentity: string;
		objectType: string;
		published: number;
		scanning: number;
	}[];
	readonly hostThrottles: readonly {
		hostIdentity: string;
		blockedUntilUs: string;
	}[];
	readonly excludedHosts: readonly string[];
	readonly excludedRoots: readonly string[];
	/** Rank supplied by PostgreSQL's text collation, not JS localeCompare. */
	readonly rootSortRanks: readonly {
		archiveUrlIdentity: string;
		sortRank: number;
	}[];
}

export interface ArchiveBrokerRamTakeOptions {
	readonly limit: number;
	readonly maximumPerHost: number;
	readonly maximumPriority: number;
	readonly context: ArchiveBrokerRamContext;
	/** Database snapshot clock advanced by the caller's monotonic elapsed time. */
	readonly nowUs?: string;
}

export interface ArchiveBrokerRamSelected {
	readonly remoteId: string;
	readonly selectedOrdinal: number;
	readonly firstPassRootReadyAt: string | null;
}
