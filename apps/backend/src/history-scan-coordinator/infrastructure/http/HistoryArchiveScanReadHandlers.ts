import type { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { InvalidUrlError } from '../../use-cases/get-latest-scan/InvalidUrlError.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';

export interface HistoryArchiveScanReadConfig {
	getLatestScan: GetLatestScan;
	getScanLogs: GetScanLogs;
}

const historyArchiveScanCacheMaxAgeSeconds = 10;

export async function handleGetArchiveScanLogs(
	req: Request,
	res: Response,
	config: HistoryArchiveScanReadConfig,
	urlParamName: string
): Promise<Response> {
	setHistoryArchiveScanCacheHeader(res);
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ errors: errors.array() });
	}

	const scanLogsOrError = await config.getScanLogs.execute(
		req.params[urlParamName]
	);
	if (
		scanLogsOrError.isErr() &&
		scanLogsOrError.error instanceof InvalidUrlError
	) {
		return res.status(400).json({ error: 'Invalid url' });
	}
	if (scanLogsOrError.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}

	return res.status(200).json(scanLogsOrError.value);
}

export async function handleGetLatestArchiveScan(
	req: Request,
	res: Response,
	config: HistoryArchiveScanReadConfig,
	urlParamName: string
): Promise<Response> {
	setHistoryArchiveScanCacheHeader(res);
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ errors: errors.array() });
	}

	const scanOrError = await config.getLatestScan.execute({
		url: req.params[urlParamName]
	});

	if (scanOrError.isErr() && scanOrError.error instanceof InvalidUrlError) {
		return res.status(400).json({ error: 'Invalid url' });
	}
	if (scanOrError.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}

	if (scanOrError.value === null) {
		return res.status(204).json({ message: 'No scan found for url' });
	}

	return res.status(200).json(scanOrError.value);
}

function setHistoryArchiveScanCacheHeader(res: Response): void {
	res.setHeader(
		'Cache-Control',
		'public, max-age=' + historyArchiveScanCacheMaxAgeSeconds
	);
}
