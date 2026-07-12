import 'reflect-metadata';
import { runOrganizationTomlBackfillCli } from './OrganizationTomlEvidenceBackfillCli.js';

process.exitCode = await runOrganizationTomlBackfillCli();
