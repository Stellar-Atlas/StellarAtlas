import 'reflect-metadata';
import { runFullHistoryPromotionCli } from './FullHistoryPromotionCli.js';

process.exitCode = await runFullHistoryPromotionCli();
