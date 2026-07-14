import 'reflect-metadata';
import { runContinuousFullHistoryOperationBackfillCli } from './ContinuousFullHistoryOperationBackfillCli.js';

process.exitCode = await runContinuousFullHistoryOperationBackfillCli();
