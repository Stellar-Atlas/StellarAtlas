import { createRequire } from 'node:module';
import type { Logger } from 'logger';
import { historyArchiveReadyNotificationChannel } from '../../repositories/database/HistoryArchiveObjectReadyQueue.js';

export const archiveBrokerRamNotificationChannel =
	'stellaratlas_history_archive_ram';
interface Notification {
	readonly channel: string;
	readonly payload?: string;
}
export interface ArchiveBrokerNotificationClient {
	connect(): Promise<void>;
	end(): Promise<void>;
	on(
		event: 'notification',
		listener: (notification: Notification) => void
	): this;
	on(event: 'error', listener: (error: Error) => void): this;
	on(event: 'end', listener: () => void): this;
	query(sql: string): Promise<unknown>;
}
const { Client } = createRequire(import.meta.url)('pg') as {
	Client: new (config: {
		connectionString: string;
		connectionTimeoutMillis: number;
		query_timeout: number;
	}) => ArchiveBrokerNotificationClient;
};

/** One connection, with reconnect/rebuild rather than trusting lost NOTIFYs. */
export class ArchiveBrokerReadyListener {
	private client: ArchiveBrokerNotificationClient | null = null;
	private connecting: Promise<void> | null = null;
	private retry: NodeJS.Timeout | null = null;
	private stopped = false;
	private delayMs = 1_000;
	constructor(
		connectionString: string,
		private readonly wake: () => void,
		private readonly change: (payload: unknown) => void,
		private readonly availability: (connected: boolean) => void,
		private readonly logger: Logger,
		private readonly factory = (): ArchiveBrokerNotificationClient =>
			new Client({
				connectionString,
				connectionTimeoutMillis: 5_000,
				query_timeout: 5_000
			})
	) {}
	async start(): Promise<void> {
		if (this.stopped || this.connecting !== null || this.client !== null)
			return;
		this.connecting = this.connect();
		try {
			await this.connecting;
		} finally {
			this.connecting = null;
		}
	}
	private async connect(): Promise<void> {
		const client = this.factory();
		this.client = client;
		client.on('notification', (notification) => {
			if (this.client !== client || this.stopped) return;
			if (notification.channel === archiveBrokerRamNotificationChannel) {
				try {
					this.change(JSON.parse(notification.payload ?? 'null') as unknown);
				} catch {
					this.change({ reset: true });
				}
				this.wake();
			} else if (
				notification.channel === historyArchiveReadyNotificationChannel
			) {
				this.wake();
			}
		});
		client.on('error', (error) => this.failed(client, error));
		client.on('end', () =>
			this.failed(client, new Error('Archive ready connection ended'))
		);
		try {
			await client.connect();
			await client.query(
				`listen ${historyArchiveReadyNotificationChannel}; listen ${archiveBrokerRamNotificationChannel}`
			);
			if (this.stopped || this.client !== client) return;
			this.delayMs = 1_000;
			this.availability(true); // LISTEN precedes snapshot, closing the bootstrap race.
			this.wake();
		} catch (error) {
			this.failed(
				client,
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}
	private failed(client: ArchiveBrokerNotificationClient, error: Error): void {
		if (this.client !== client) return;
		this.client = null;
		this.availability(false);
		void client.end().catch(() => undefined);
		if (this.stopped) return;
		this.logger.error(
			'Archive ready listener reconnecting; RAM snapshot invalidated',
			{ errorMessage: error.message }
		);
		this.wake();
		if (this.retry !== null) return;
		this.retry = setTimeout(() => {
			this.retry = null;
			// An error can arrive before connect() settles. Never lose that retry.
			void (this.connecting ?? Promise.resolve()).then(() => this.start());
		}, this.delayMs);
		this.delayMs = Math.min(30_000, this.delayMs * 2);
		this.retry.unref();
	}
	async close(): Promise<void> {
		this.stopped = true;
		if (this.retry !== null) clearTimeout(this.retry);
		this.retry = null;
		this.availability(false);
		const client = this.client;
		this.client = null;
		await client?.end().catch(() => undefined);
		await this.connecting;
	}
}
