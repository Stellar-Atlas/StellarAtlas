import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservationV1 } from 'shared';
import type {
	GetScpStatements,
	ScpStatementReadFreshness,
	ScpStatementReadResult,
	ScpStatementReadSource
} from '../../use-cases/get-scp-statements/GetScpStatements.js';
import type { ScpStatementLiveCursor } from '../../domain/scp/ScpStatementLiveStore.js';
import {
	compareScpStatement,
	compareScpStatementCursor,
	createScpStatementStreamState,
	selectBoundedScpStatementDelta,
	type ScpStatementStreamState
} from './ScpStatementStreamState.js';
import { scpStatementDeltaByteLimit } from './ScpStatementTransportPolicy.js';

export interface ScpStatementLiveMetadata {
	readonly freshness: ScpStatementReadFreshness;
	readonly freshnessMs: number | null;
	readonly observedAt: string | null;
	readonly source: ScpStatementReadSource;
}

export interface ScpStatementLiveUpdate {
	readonly cursor: ScpStatementLiveCursor | null;
	readonly metadata: ScpStatementLiveMetadata;
	readonly metadataChanged: boolean;
	readonly statements: readonly ScpStatementObservationV1[];
	readonly truncated: boolean;
}

export interface ScpStatementLiveSubscriber {
	onError(message: string): boolean | void;
	onUpdate(update: ScpStatementLiveUpdate): boolean | void;
}

export interface ScpStatementLiveHubOptions {
	intervalMs?: number;
	limit?: number;
	maxDeltaBytes?: number;
	maxSubscribers?: number;
}

interface SubscriberState {
	lastMetadataKey: string | null;
	lastTruncated: boolean;
	state: ScpStatementStreamState;
	subscriber: ScpStatementLiveSubscriber;
}

type Reader = Pick<GetScpStatements, 'executeWithMetadata'>;

const defaultIntervalMs = 1_200;
const defaultLimit = 1_000;
const totalLiveClientLimit = 256;
const sharedHubs = new WeakMap<Reader, ScpStatementLiveHub>();

export class ScpStatementLiveHub {
	private readonly intervalMs: number;
	private readonly limit: number;
	private readonly maxDeltaBytes: number;
	private readonly maxSubscribers: number;
	private polling = false;
	private readonly subscribers = new Map<symbol, SubscriberState>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly reader: Reader,
		private readonly logger?: Logger,
		options: ScpStatementLiveHubOptions = {}
	) {
		this.intervalMs = Math.max(100, options.intervalMs ?? defaultIntervalMs);
		this.limit = Math.max(
			1,
			Math.min(defaultLimit, options.limit ?? defaultLimit)
		);
		this.maxDeltaBytes = Math.max(
			2,
			Math.min(
				scpStatementDeltaByteLimit,
				options.maxDeltaBytes ?? scpStatementDeltaByteLimit
			)
		);
		this.maxSubscribers = Math.max(
			1,
			Math.min(
				totalLiveClientLimit,
				options.maxSubscribers ?? totalLiveClientLimit
			)
		);
	}

	subscribe(
		subscriber: ScpStatementLiveSubscriber,
		resumeCursor: ScpStatementLiveCursor | null = null
	): (() => void) | null {
		if (this.subscribers.size >= this.maxSubscribers) return null;
		const id = Symbol('scp-live-subscriber');
		this.subscribers.set(id, {
			lastMetadataKey: null,
			lastTruncated: false,
			state: createScpStatementStreamState(resumeCursor),
			subscriber
		});
		this.clearTimer();
		this.poll();
		return () => this.remove(id);
	}

	private poll(): void {
		if (this.polling || this.subscribers.size === 0) return;
		this.polling = true;
		const readState = this.getOldestReadState();
		const readCursor = readState?.cursor ?? null;
		const readOrder = readState === undefined ? 'desc' : 'asc';
		let continueImmediately = false;
		void Promise.resolve()
			.then(() =>
				this.reader.executeWithMetadata({
					after: readCursor ?? undefined,
					limit: this.limit,
					order: readOrder,
					source: 'auto'
				})
			)
			.then((result) => {
				if (result.isErr()) {
					this.broadcastError('SCP statements unavailable');
					return;
				}
				const pageMayHaveMore = result.value.observations.length >= this.limit;
				const advanced = this.broadcast(
					result.value,
					readCursor,
					readOrder,
					pageMayHaveMore
				);
				continueImmediately = pageMayHaveMore && advanced;
			})
			.catch((error: unknown) => {
				this.logger?.error('Shared SCP live polling failed', {
					errorMessage: error instanceof Error ? error.message : String(error)
				});
				this.broadcastError('SCP statements unavailable');
			})
			.finally(() => {
				this.polling = false;
				this.schedule(continueImmediately ? 0 : this.intervalMs);
			});
	}

	private broadcast(
		result: ScpStatementReadResult,
		readCursor: ScpStatementLiveCursor | null,
		readOrder: 'asc' | 'desc',
		pageMayHaveMore: boolean
	): boolean {
		const statements = result.observations.toSorted(compareScpStatement);
		const metadata = toMetadata(result);
		const metadataKey = JSON.stringify(metadata);
		let advanced = false;
		for (const [id, client] of this.subscribers) {
			if (!canApplyRead(client.state, readCursor, readOrder)) continue;
			const previousCursor = client.state.cursor;
			const metadataChanged = client.lastMetadataKey !== metadataKey;
			this.deliverBoundedUpdates(
				id,
				client,
				statements,
				metadata,
				metadataChanged,
				metadataKey,
				pageMayHaveMore
			);
			if (cursorAdvanced(previousCursor, client.state.cursor)) advanced = true;
		}
		return advanced;
	}

	private deliverBoundedUpdates(
		id: symbol,
		client: SubscriberState,
		statements: readonly ScpStatementObservationV1[],
		metadata: ScpStatementLiveMetadata,
		metadataChanged: boolean,
		metadataKey: string,
		pageMayHaveMore: boolean
	): void {
		let includeMetadata = metadataChanged;
		for (;;) {
			const delta = selectBoundedScpStatementDelta(
				client.state,
				statements,
				this.maxDeltaBytes
			);
			if (delta.oversizedStatementHash !== null) {
				this.logger?.warn('SCP statement exceeds live transport limit', {
					statementHash: delta.oversizedStatementHash
				});
				this.deliverError(id, client, 'SCP statement exceeds transport limit');
				this.remove(id);
				return;
			}
			if (delta.statements.length === 0) {
				const truncated = pageMayHaveMore;
				if (includeMetadata || client.lastTruncated !== truncated) {
					client.lastMetadataKey = metadataKey;
					client.lastTruncated = truncated;
					this.deliver(id, client, {
						cursor: client.state.cursor,
						metadata,
						metadataChanged: includeMetadata,
						statements: [],
						truncated
					});
				}
				return;
			}
			client.lastMetadataKey = metadataKey;
			const truncated = delta.hasMore || pageMayHaveMore;
			if (
				!this.deliver(id, client, {
					cursor: client.state.cursor,
					metadata,
					metadataChanged: includeMetadata,
					statements: delta.statements,
					truncated
				})
			) {
				return;
			}
			client.lastTruncated = truncated;
			if (!delta.hasMore) return;
			includeMetadata = false;
		}
	}

	private broadcastError(message: string): void {
		for (const [id, client] of this.subscribers) {
			this.deliverError(id, client, message);
		}
	}

	private deliverError(
		id: symbol,
		client: SubscriberState,
		message: string
	): void {
		try {
			if (client.subscriber.onError(message) === false) this.remove(id);
		} catch (error) {
			this.logSubscriberFailure(error);
			this.remove(id);
		}
	}

	private deliver(
		id: symbol,
		client: SubscriberState,
		update: ScpStatementLiveUpdate
	): boolean {
		try {
			if (client.subscriber.onUpdate(update) === false) {
				this.remove(id);
				return false;
			}
			return true;
		} catch (error) {
			this.logSubscriberFailure(error);
			this.remove(id);
			return false;
		}
	}

	private getOldestReadState(): ScpStatementStreamState | undefined {
		let oldest: ScpStatementStreamState | undefined;
		for (const { state } of this.subscribers.values()) {
			if (state.cursor === null) return undefined;
			if (
				oldest === undefined ||
				(oldest.cursor !== null &&
					compareScpStatementCursor(state.cursor, oldest.cursor) < 0)
			) {
				oldest = state;
			}
		}
		return oldest;
	}

	private schedule(delayMs: number): void {
		if (this.subscribers.size === 0 || this.timer !== undefined) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.poll();
		}, delayMs);
		this.timer.unref();
	}

	private remove(id: symbol): void {
		this.subscribers.delete(id);
		if (this.subscribers.size === 0) this.clearTimer();
	}

	private clearTimer(): void {
		if (this.timer === undefined) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private logSubscriberFailure(error: unknown): void {
		this.logger?.warn('SCP live subscriber failed', {
			errorMessage: error instanceof Error ? error.message : String(error)
		});
	}
}

export function getSharedScpStatementLiveHub(
	reader: Reader,
	logger?: Logger
): ScpStatementLiveHub {
	const existing = sharedHubs.get(reader);
	if (existing !== undefined) return existing;
	const hub = new ScpStatementLiveHub(reader, logger);
	sharedHubs.set(reader, hub);
	return hub;
}

function toMetadata(result: ScpStatementReadResult): ScpStatementLiveMetadata {
	return {
		freshness: result.freshness,
		freshnessMs: result.freshnessMs,
		observedAt: result.observedAt,
		source: result.source
	};
}

function canApplyRead(
	state: ScpStatementStreamState,
	readCursor: ScpStatementLiveCursor | null,
	readOrder: 'asc' | 'desc'
): boolean {
	if (readOrder === 'desc') return state.cursor === null;
	return (
		readCursor !== null &&
		state.cursor !== null &&
		compareScpStatementCursor(state.cursor, readCursor) >= 0
	);
}

function cursorAdvanced(
	previous: ScpStatementLiveCursor | null,
	current: ScpStatementLiveCursor | null
): boolean {
	if (current === null) return false;
	return previous === null || compareScpStatementCursor(current, previous) > 0;
}
