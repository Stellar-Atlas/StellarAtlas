import type { Logger } from '@core/services/Logger.js';
import { WebSocket } from 'ws';

export interface BoundedWebSocketSenderOptions {
	closeGraceMs?: number;
	maxBufferedBytes?: number;
}

const defaultCloseGraceMs = 1_000;
const defaultMaxBufferedBytes = 4_194_304;

export class BoundedWebSocketSender {
	private readonly closeGraceMs: number;
	private closing = false;
	private cleanupComplete = false;
	private readonly maxBufferedBytes: number;
	private terminateTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly socket: WebSocket,
		private readonly cleanup: () => void,
		private readonly logger?: Logger,
		options: BoundedWebSocketSenderOptions = {}
	) {
		this.closeGraceMs = Math.max(
			1,
			Math.min(defaultCloseGraceMs, options.closeGraceMs ?? defaultCloseGraceMs)
		);
		this.maxBufferedBytes = Math.max(
			1,
			Math.min(
				defaultMaxBufferedBytes,
				options.maxBufferedBytes ?? defaultMaxBufferedBytes
			)
		);
	}

	send(payload: string): boolean {
		if (this.closing) return false;
		if (this.socket.readyState !== WebSocket.OPEN) {
			this.terminate();
			return false;
		}
		const payloadBytes = Buffer.byteLength(payload);
		if (
			payloadBytes > this.maxBufferedBytes ||
			this.socket.bufferedAmount + payloadBytes > this.maxBufferedBytes
		) {
			this.close(1013, 'backpressure');
			return false;
		}
		try {
			this.socket.send(payload, (error) => {
				if (error === undefined || error === null) return;
				this.logger?.warn('Live WebSocket send failed', {
					errorMessage: error.message
				});
				this.close(1011, 'send failure');
			});
			return true;
		} catch (error) {
			this.logger?.warn('Live WebSocket send threw', {
				errorMessage: error instanceof Error ? error.message : String(error)
			});
			this.close(1011, 'send failure');
			return false;
		}
	}

	close(code = 1001, reason = 'closing'): void {
		if (this.closing) return;
		this.closing = true;
		this.runCleanup();
		if (this.socket.readyState !== WebSocket.OPEN) {
			this.terminate();
			return;
		}
		this.terminateTimer = setTimeout(() => this.terminate(), this.closeGraceMs);
		this.terminateTimer.unref();
		try {
			this.socket.close(code, reason);
		} catch {
			this.terminate();
		}
	}

	markClosed(): void {
		this.closing = true;
		this.clearTerminateTimer();
		this.runCleanup();
	}

	terminate(): void {
		this.closing = true;
		this.clearTerminateTimer();
		this.runCleanup();
		if (this.socket.readyState === WebSocket.CLOSED) return;
		try {
			this.socket.terminate();
		} catch {
			// Cleanup has already run; the socket cannot retain a live subscription.
		}
	}

	private runCleanup(): void {
		if (this.cleanupComplete) return;
		this.cleanupComplete = true;
		this.cleanup();
	}

	private clearTerminateTimer(): void {
		if (this.terminateTimer === undefined) return;
		clearTimeout(this.terminateTimer);
		this.terminateTimer = undefined;
	}
}
