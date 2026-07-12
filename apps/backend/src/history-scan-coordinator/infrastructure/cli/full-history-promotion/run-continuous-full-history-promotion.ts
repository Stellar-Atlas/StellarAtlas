import 'reflect-metadata';
import { runContinuousFullHistoryPromotionCli } from './ContinuousFullHistoryPromotionCli.js';

process.exitCode = await runContinuousFullHistoryPromotionCli();
