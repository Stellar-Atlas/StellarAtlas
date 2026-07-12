import 'reflect-metadata';
import { runFullHistoryOperationBackfillCli } from './FullHistoryOperationBackfillCli.js';

process.exitCode = await runFullHistoryOperationBackfillCli();
