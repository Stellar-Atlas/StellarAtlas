import 'reflect-metadata';
import { runFullHistoryStateImportCli } from './FullHistoryStateImportCli.js';

process.exitCode = await runFullHistoryStateImportCli();
