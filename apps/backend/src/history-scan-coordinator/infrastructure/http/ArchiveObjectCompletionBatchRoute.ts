import type { Router } from 'express';
import basicAuth from 'express-basic-auth';
import { body, validationResult } from 'express-validator';
import type {
	CompleteHistoryArchiveObject,
	CompleteHistoryArchiveObjectRequest
} from '../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { historyArchiveCompletionWriteConfigFromEnv } from '../../use-cases/reconcile-history-archive-object-transitions/HistoryArchiveMaintenanceConfig.js';
import {
	frontendCacheTags,
	type FrontendRevalidationConfig,
	triggerFrontendRevalidation
} from '@core/services/FrontendRevalidation.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { parseArchiveObjectCompletion } from './ArchiveObjectJobRequestParsers.js';

interface BatchRouteConfig extends FrontendRevalidationConfig {
	readonly userName?: string;
	readonly password?: string;
	readonly completeHistoryArchiveObject: Pick<
		CompleteHistoryArchiveObject,
		'execute'
	>;
}

export function registerArchiveObjectCompletionBatchRoute(
	router: Router,
	config: BatchRouteConfig
): void {
	if (!config.userName || !config.password) return;
	const maximumItems = historyArchiveCompletionWriteConfigFromEnv().batchSize;
	router.post(
		'/archive-object-jobs/complete-batch',
		basicAuth({
			users: { [config.userName]: config.password },
			challenge: true
		}),
		body('items.*.remoteId')
			.isUUID()
			.withMessage('Invalid archive object remoteId'),
		async (req, res) => {
			const errors = validationResult(req);
			if (!errors.isEmpty())
				return res.status(400).json({ errors: errors.array() });
			const requestBody: unknown = req.body;
			if (
				!isRecord(requestBody) ||
				!Array.isArray(requestBody.items) ||
				requestBody.items.length === 0
			) {
				return res
					.status(400)
					.json({ error: 'items must be a non-empty array' });
			}
			if (requestBody.items.length > maximumItems) {
				return res
					.status(413)
					.json({
						error: 'Completion batch exceeds the configured write batch size',
						maxItems: maximumItems
					});
			}
			const parsed: {
				remoteId: string;
				completion: CompleteHistoryArchiveObjectRequest;
			}[] = [];
			const seen = new Set<string>();
			// Validate the entire request before admitting any result to persistence.
			for (const item of requestBody.items as unknown[]) {
				if (!isRecord(item) || typeof item.remoteId !== 'string') {
					return res
						.status(400)
						.json({ error: 'Each item requires remoteId and completion' });
				}
				const identity = item.remoteId.toLowerCase();
				if (seen.has(identity))
					return res
						.status(400)
						.json({ error: 'Duplicate archive object remoteId' });
				seen.add(identity);
				const completion = parseArchiveObjectCompletion(
					{ body: item.completion },
					res
				);
				if (completion === null) return;
				parsed.push({ remoteId: item.remoteId, completion });
			}
			// Synchronous admission into the existing coalescer preserves set-based writes.
			const items = await Promise.all(
				parsed.map(async ({ remoteId, completion }) => {
					const identity = {
						remoteId,
						claimAttempt: completion.claimAttempt,
						executionId: completion.executionId
					};
					try {
						const result = await config.completeHistoryArchiveObject.execute(
							remoteId,
							completion
						);
						if (result.isErr())
							return {
								...identity,
								status: 'retry' as const,
								error: result.error.message
							};
						return {
							...identity,
							status: result.value ? ('accepted' as const) : ('stale' as const)
						};
					} catch (error) {
						return {
							...identity,
							status: 'retry' as const,
							error: mapUnknownToError(error).message
						};
					}
				})
			);
			if (items.some((item) => item.status === 'accepted')) {
				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);
			}
			return res.status(200).json({ items });
		}
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
