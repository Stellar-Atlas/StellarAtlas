import 'reflect-metadata';
import { runFullHistoryBackfillCli } from './FullHistoryBackfillCli.js';

process.exitCode = await runFullHistoryBackfillCli();
