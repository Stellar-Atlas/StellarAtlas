import { JSONSchemaType } from 'ajv';

export interface HistoryArchiveState {
	version: number;
	server: string;
	currentLedger: number;
	networkPassphrase?: string | null;
	currentBuckets: HistoryStateBucket[];
	hotArchiveBuckets?: HistoryStateBucket[];
}

export interface HistoryStateBucket {
	curr: string;
	snap: string;
	next: {
		state: number;
		output?: string | null;
	};
}

export const HistoryArchiveStateSchema: JSONSchemaType<HistoryArchiveState> = {
	type: 'object',
	properties: {
		version: { type: 'integer' },
		server: { type: 'string' },
		currentLedger: { type: 'number' },
		networkPassphrase: { type: 'string', nullable: true },
		currentBuckets: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					curr: { type: 'string' },
					snap: { type: 'string' },
					next: {
						type: 'object',
						properties: {
							state: { type: 'number' },
							output: { type: 'string', nullable: true }
						},
						required: ['state']
					}
				},
				required: ['curr', 'snap', 'next']
			},
			minItems: 0
		},
		hotArchiveBuckets: {
			type: 'array',
			nullable: true,
			items: {
				type: 'object',
				properties: {
					curr: { type: 'string' },
					snap: { type: 'string' },
					next: {
						type: 'object',
						properties: {
							state: { type: 'number' },
							output: { type: 'string', nullable: true }
						},
						required: ['state']
					}
				},
				required: ['curr', 'snap', 'next']
			},
			minItems: 0
		}
	},
	required: ['version', 'server', 'currentLedger', 'currentBuckets']
};
