import 'reflect-metadata';
import { runContinuousFullHistoryBackfillCli } from './ContinuousFullHistoryBackfillCli.js';

process.exitCode = await runContinuousFullHistoryBackfillCli();
