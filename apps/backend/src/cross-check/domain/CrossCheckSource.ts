export type CrossCheckSourceKind = 'external' | 'internal';

export type CrossCheckSourceScope = 'archives' | 'organizations' | 'validators';

export type CrossCheckProbeMode = 'not_run';

export interface CrossCheckSourceDTO {
	readonly description: string;
	readonly documentationUrl: string | null;
	readonly id: string;
	readonly kind: CrossCheckSourceKind;
	readonly name: string;
	readonly probe: CrossCheckProbeMode;
	readonly scopes: readonly CrossCheckSourceScope[];
	readonly url: string;
}

export interface CrossCheckSourcesDTO {
	readonly generatedAt: string;
	readonly probe: CrossCheckProbeMode;
	readonly sources: readonly CrossCheckSourceDTO[];
}
