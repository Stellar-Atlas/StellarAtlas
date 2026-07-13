import type { JSONSchemaType } from 'ajv';
import {
	HistoryArchiveObjectEventPageV1Schema,
	type HistoryArchiveObjectEventPageV1,
	HistoryArchiveObjectPageV1Schema,
	type HistoryArchiveObjectPageV1
} from './history-archive-evidence-page-v1.js';
import {
	KnownArchiveRemoteFailurePageV1Schema,
	type KnownArchiveRemoteFailurePageV1,
	KnownArchiveRootEvidenceV1Schema,
	type KnownArchiveRootEvidenceV1,
	KnownArchiveWorkerIssuePageV1Schema,
	type KnownArchiveWorkerIssuePageV1
} from './known-archive-evidence-v1.js';

export interface HistoryArchiveEvidenceV2 {
	readonly archiveUrl: string;
	readonly eventPage: HistoryArchiveObjectEventPageV1;
	readonly generatedAt: string;
	readonly objectPage: HistoryArchiveObjectPageV1;
	readonly remoteFailures: KnownArchiveRemoteFailurePageV1;
	readonly root: KnownArchiveRootEvidenceV1;
	readonly workerIssues: KnownArchiveWorkerIssuePageV1;
}

export const HistoryArchiveEvidenceV2Schema: JSONSchemaType<HistoryArchiveEvidenceV2> =
	{
		$id: 'history-archive-evidence-v2.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			eventPage: HistoryArchiveObjectEventPageV1Schema,
			generatedAt: { type: 'string', format: 'date-time' },
			objectPage: HistoryArchiveObjectPageV1Schema,
			remoteFailures: KnownArchiveRemoteFailurePageV1Schema,
			root: KnownArchiveRootEvidenceV1Schema,
			workerIssues: KnownArchiveWorkerIssuePageV1Schema
		},
		required: [
			'archiveUrl',
			'eventPage',
			'generatedAt',
			'objectPage',
			'remoteFailures',
			'root',
			'workerIssues'
		],
		additionalProperties: false
	};
