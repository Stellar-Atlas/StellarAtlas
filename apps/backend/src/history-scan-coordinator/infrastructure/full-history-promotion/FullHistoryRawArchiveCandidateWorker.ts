import { parentPort, workerData } from 'node:worker_threads';
import {
	decodeRawCheckpoint,
	type RawCheckpointInput
} from './FullHistoryRawArchiveCandidateRows.js';

if (parentPort === null)
	throw new Error('Raw candidate decoder requires a worker');
// The only sender is our bounded local repository, not a public transport.
parentPort.postMessage(decodeRawCheckpoint(workerData as RawCheckpointInput));
