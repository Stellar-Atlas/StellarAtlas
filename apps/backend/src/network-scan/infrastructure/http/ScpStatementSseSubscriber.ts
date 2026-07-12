import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementLiveSubscriber } from './ScpStatementLiveHub.js';

export interface ScpStatementSseResponse {
	end(): void;
	readonly writableEnded: boolean;
	write(chunk: string): boolean;
}

export const createScpStatementSseSubscriber = (
	response: ScpStatementSseResponse,
	logger?: Logger
): ScpStatementLiveSubscriber => {
	const writeEvent = (event: string, data: unknown): boolean => {
		if (response.writableEnded) return false;
		try {
			if (
				response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
			) {
				return true;
			}
		} catch (error) {
			logger?.warn('SCP SSE client write failed', {
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		}
		if (!response.writableEnded) response.end();
		return false;
	};

	return {
		onError: (message) => writeEvent('error', { message }),
		onUpdate: ({ metadata, metadataChanged, statements }) => {
			if (metadataChanged && !writeEvent('scp-metadata', metadata)) {
				return false;
			}
			return statements.length === 0 || writeEvent('scp', statements);
		}
	};
};
