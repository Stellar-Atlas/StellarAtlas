import { connect, type Consumer, type JsMsg, type NatsConnection } from 'nats';
import type { HistoryArchiveObjectJobDTO } from '../../domain/scan/ScanCoordinatorService.js';
import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from '../../use-cases/verify-archive-objects/HistoryArchiveObjectJobDelivery.js';

export interface NatsHistoryArchiveObjectJobSourceConfig {
	readonly capacitySignalSubject: string;
	readonly consumer: string;
	readonly name: string;
	readonly servers: readonly string[];
	readonly stream: string;
	readonly token: string | undefined;
}

interface BrokerJobEnvelope {
	readonly executionId: string;
	readonly job: HistoryArchiveObjectJobDTO;
}

const objectTypes = new Set([
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNullableString(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value === 'string') return value;
	throw new Error(`Invalid archive broker field: ${field}`);
}

function requireNullableNumber(value: unknown, field: string): number | null {
	if (value === null) return null;
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
		return value;
	throw new Error(`Invalid archive broker field: ${field}`);
}

function requireString(value: unknown, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Invalid archive broker field: ${field}`);
}

function parseJob(value: unknown): HistoryArchiveObjectJobDTO {
	if (!isRecord(value)) throw new Error('Invalid archive broker job');
	const objectType = requireString(value.objectType, 'job.objectType');
	if (!objectTypes.has(objectType))
		throw new Error('Invalid archive broker field: job.objectType');
	const claimAttempt = requireNullableNumber(
		value.claimAttempt,
		'job.claimAttempt'
	);
	if (claimAttempt === null || claimAttempt < 1)
		throw new Error('Invalid archive broker field: job.claimAttempt');

	return {
		archiveUrl: requireString(value.archiveUrl, 'job.archiveUrl'),
		bucketHash: requireNullableString(value.bucketHash, 'job.bucketHash'),
		checkpointLedger: requireNullableNumber(
			value.checkpointLedger,
			'job.checkpointLedger'
		),
		claimAttempt,
		objectKey: requireString(value.objectKey, 'job.objectKey'),
		objectType: objectType as HistoryArchiveObjectJobDTO['objectType'],
		objectUrl: requireString(value.objectUrl, 'job.objectUrl'),
		remoteId: requireString(value.remoteId, 'job.remoteId')
	};
}

function parseEnvelope(message: JsMsg): BrokerJobEnvelope {
	const value: unknown = message.json();
	if (!isRecord(value)) throw new Error('Invalid archive broker envelope');
	return {
		executionId: requireString(value.executionId, 'executionId'),
		job: parseJob(value.job)
	};
}

export class NatsHistoryArchiveObjectJobSource implements HistoryArchiveObjectJobSource {
	readonly kind = 'broker' as const;
	private connection: NatsConnection | null = null;
	private consumer: Consumer | null = null;
	private consumerPromise: Promise<Consumer> | null = null;
	private closed = false;

	constructor(
		private readonly config: NatsHistoryArchiveObjectJobSourceConfig
	) {}

	async next(): Promise<HistoryArchiveObjectJobDelivery | null> {
		if (this.closed) return null;
		const consumer = await this.getConsumer();
		const message = await consumer.next({ expires: 30_000 });
		if (message === null) return null;

		let envelope: BrokerJobEnvelope;
		try {
			envelope = parseEnvelope(message);
		} catch (error) {
			// Preserve the durable frontier so a corrected worker can consume the job.
			message.nak(60_000);
			throw error;
		}

		let settled = false;
		const settle = (action: () => void): void => {
			if (settled) return;
			settled = true;
			action();
		};

		return {
			acknowledge: async () => {
				if (settled) return;
				const acknowledged = await message.ackAck({ timeout: 5_000 });
				if (!acknowledged)
					throw new Error('Archive broker acknowledgement timed out');
				settled = true;
				this.connection?.publish(this.config.capacitySignalSubject);
			},
			executionId: envelope.executionId,
			heartbeat: async () => {
				if (!settled) message.working();
			},
			job: envelope.job,
			release: async () => settle(() => message.nak()),
			retry: async (delayMs) =>
				settle(() => message.nak(Math.max(1_000, Math.floor(delayMs)))),
			source: 'broker'
		};
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.consumerPromise !== null) {
			try {
				await this.consumerPromise;
			} catch {
				// A failed connection has nothing to drain.
			}
		}
		const connection = this.connection;
		this.consumer = null;
		this.consumerPromise = null;
		this.connection = null;
		if (connection !== null) await connection.drain();
	}

	private async getConsumer(): Promise<Consumer> {
		if (this.consumer !== null) return this.consumer;
		if (this.consumerPromise === null) {
			this.consumerPromise = this.connectConsumer();
		}
		try {
			return await this.consumerPromise;
		} catch (error) {
			this.consumerPromise = null;
			throw error;
		}
	}

	private async connectConsumer(): Promise<Consumer> {
		const connection = await connect({
			name: this.config.name,
			servers: [...this.config.servers],
			...(this.config.token === undefined ? {} : { token: this.config.token })
		});
		try {
			const jetStream = connection.jetstream();
			const consumer = await jetStream.consumers.get(
				this.config.stream,
				this.config.consumer
			);
			this.connection = connection;
			this.consumer = consumer;
			return consumer;
		} catch (error) {
			await connection.close();
			throw error;
		}
	}
}
