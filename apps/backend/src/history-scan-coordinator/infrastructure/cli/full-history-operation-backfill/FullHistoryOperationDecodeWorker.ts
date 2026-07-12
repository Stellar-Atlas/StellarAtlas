import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { StellarFullHistoryCheckpointDecoder } from '../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import { parseFullHistoryOperationDecodeWorkerRequest } from './FullHistoryOperationWorkerCandidateCodec.js';
import {
	failedFullHistoryOperationWorkerResponse,
	successfulFullHistoryOperationWorkerResponse,
	type FullHistoryOperationWorkerResponse
} from './FullHistoryOperationWorkerProtocol.js';

if (isMainThread || parentPort === null) {
	throw new Error('Full-history operation decoder must run in a worker thread');
}

let response: FullHistoryOperationWorkerResponse;
try {
	const request = parseFullHistoryOperationDecodeWorkerRequest(workerData);
	const decoded = await new StellarFullHistoryCheckpointDecoder().decode(
		request.candidate,
		request.networkPassphrase
	);
	response = successfulFullHistoryOperationWorkerResponse(decoded);
} catch (error) {
	response = failedFullHistoryOperationWorkerResponse(error);
}
parentPort.postMessage(response);
