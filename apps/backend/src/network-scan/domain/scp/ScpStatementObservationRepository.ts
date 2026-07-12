import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservation } from './ScpStatementObservation.js';

export interface ScpStatementObservationFilter {
	after?: ScpStatementReadCursor;
	limit: number;
	nodeId?: string;
	order?: ScpStatementReadOrder;
	slotIndex?: string;
}

export interface ScpStatementReadCursor {
	observedAtMs: number;
	statementHash: string;
}

export type ScpStatementReadOrder = 'asc' | 'desc';

export type ScpStatementWriter = 'network_scan' | 'scp_live_collector';

export interface ScpLatestObservedLedger {
	closedAt: Date;
	observedAt: Date;
	sequence: string;
	source: ScpStatementWriter;
}

export interface ScpStatementAnimationValue {
	readonly closeTime: string;
	readonly txSetHash: string;
}

export interface ScpStatementAnimationObservation {
	readonly nodeId: string;
	readonly observedAt: Date;
	readonly observedFromPeer: string;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statementHash: string;
	readonly statementType: CrawlerScpStatementObservation['statementType'];
	readonly values: readonly ScpStatementAnimationValue[];
}

export interface ScpStatementProjectionPageFilter {
	afterId: number;
	limit: number;
	observedAfter: Date;
}

export interface ScpStatementProjectionPage {
	nextAfterId: number | null;
	observations: CrawlerScpStatementObservation[];
}

export interface ScpStatementProjectionEventPageFilter {
	afterId: number;
	limit: number;
}

export interface ScpStatementProjectionEventPage {
	hasMore: boolean;
	nextAfterId: number;
	observations: CrawlerScpStatementObservation[];
}

export interface ScpStatementObservationRepository {
	deleteOlderThan(before: Date, limit: number): Promise<number>;
	deleteProjectionEventsOlderThan(before: Date, limit: number): Promise<number>;
	saveMany(
		observations: readonly CrawlerScpStatementObservation[],
		writer: ScpStatementWriter
	): Promise<CrawlerScpStatementObservation[]>;
	findLatestObservedLedger(): Promise<ScpLatestObservedLedger | null>;
	findLatestAnimationSlots(
		limit: number
	): Promise<ScpStatementAnimationObservation[]>;
	findProjectionEventPage(
		filter: ScpStatementProjectionEventPageFilter
	): Promise<ScpStatementProjectionEventPage>;
	findProjectionPage(
		filter: ScpStatementProjectionPageFilter
	): Promise<ScpStatementProjectionPage>;
	findLatest(
		filter: ScpStatementObservationFilter
	): Promise<ScpStatementObservation[]>;
}
