import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservationV1 } from 'shared';
import type {
	GetScpStatements,
	ScpStatementReadFreshness,
	ScpStatementReadResult,
	ScpStatementReadSource
} from '../../use-cases/get-scp-statements/GetScpStatements.js';
import {
	compareScpStatement,
	compareScpStatementCursor,
	createScpStatementStreamState,
	getScpStatementReadCursor,
	getScpStatementReadOrder,
	selectScpStatementDelta,
	type ScpStatementStreamState
} from './ScpStatementStreamState.js';

export interface ScpStatementLiveMetadata {
	readonly freshness: ScpStatementReadFreshness;
	readonly freshnessMs: number | null;
	readonly observedAt: string | null;
	readonly source: ScpStatementReadSource;
}

export interface ScpStatementLiveUpdate {
	readonly metadata: ScpStatementLiveMetadata;
	readonly metadataChanged: boolean;
	readonly statements: readonly ScpStatementObservationV1[];
}

export interface ScpStatementLiveSubscriber {
	onError(message: string): boolean | void;
	onUpdate(update: ScpStatementLiveUpdate): boolean | void;
}

export interface ScpStatementLiveHubOptions {
	intervalMs?: number;
	limit?: number;
	maxSubscribers?: number;
}

interface SubscriberState {
	lastMetadataKey: string | null;
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
		this.maxSubscribers = Math.max(
			1,
			Math.min(
				totalLiveClientLimit,
				options.maxSubscribers ?? totalLiveClientLimit
			)
		);
	}

	subscribe(subscriber: ScpStatementLiveSubscriber): (() => void) | null {
		if (this.subscribers.size >= this.maxSubscribers) return null;
		const id = Symbol('scp-live-subscriber');
		this.subscribers.set(id, {
			lastMetadataKey: null,
			state: createScpStatementStreamState(),
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
		void Promise.resolve()
			.then(() =>
				this.reader.executeWithMetadata({
					after:
						readState === undefined
							? undefined
							: getScpStatementReadCursor(readState),
					limit: this.limit,
					order:
						readState === undefined
							? 'desc'
							: getScpStatementReadOrder(readState),
					source: 'auto'
				})
			)
			.then((result) => {
				if (result.isErr()) {
					this.broadcastError('SCP statements unavailable');
					return;
				}
				this.broadcast(result.value);
			})
			.catch((error: unknown) => {
				this.logger?.error('Shared SCP live polling failed', {
					errorMessage: error instanceof Error ? error.message : String(error)
				});
				this.broadcastError('SCP statements unavailable');
			})
			.finally(() => {
				this.polling = false;
				this.schedule();
			});
	}

	private broadcast(result: ScpStatementReadResult): void {
		const statements = result.observations.toSorted(compareScpStatement);
		const metadata = toMetadata(result);
		const metadataKey = JSON.stringify(metadata);
		for (const [id, client] of this.subscribers) {
			const delta = selectScpStatementDelta(client.state, statements);
			const metadataChanged = client.lastMetadataKey !== metadataKey;
			if (!metadataChanged && delta.length === 0) continue;
			client.lastMetadataKey = metadataKey;
			this.deliver(id, client, {
				metadata,
				metadataChanged,
				statements: delta
			});
		}
	}

	private broadcastError(message: string): void {
		for (const [id, client] of this.subscribers) {
			try {
				if (client.subscriber.onError(message) === false) this.remove(id);
			} catch (error) {
				this.logSubscriberFailure(error);
				this.remove(id);
			}
		}
	}

	private deliver(
		id: symbol,
		client: SubscriberState,
		update: ScpStatementLiveUpdate
	): void {
		try {
			if (client.subscriber.onUpdate(update) === false) this.remove(id);
		} catch (error) {
			this.logSubscriberFailure(error);
			this.remove(id);
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

	private schedule(): void {
		if (this.subscribers.size === 0 || this.timer !== undefined) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.poll();
		}, this.intervalMs);
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
