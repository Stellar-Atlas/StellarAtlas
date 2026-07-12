import type express from 'express';
import {
	isHistoryArchiveWorkerReportDTO,
	type HistoryArchiveWorkerReportDTO
} from 'history-scanner-dto';

export function parseHistoryArchiveWorkerStatusReport(
	req: express.Request,
	res: express.Response
): HistoryArchiveWorkerReportDTO | null {
	if (!isHistoryArchiveWorkerReportDTO(req.body)) {
		res.status(400).json({ error: 'Invalid archive worker status report' });
		return null;
	}

	return req.body;
}
