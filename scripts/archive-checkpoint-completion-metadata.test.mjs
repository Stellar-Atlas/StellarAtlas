import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isArchiveMetadataDTO } from '../packages/history-scanner-dto/src/ArchiveMetadataDTO.ts';

const coordinator = new URL('../apps/backend/src/history-scan-coordinator/', import.meta.url);
const source = (path) => readFileSync(new URL(path, coordinator), 'utf8').replace(/\s+/g, ' ');
const database = 'infrastructure/repositories/database/';

// These checks pin source contracts. They do not execute or emulate PostgreSQL.
test('the completion write omits only an equal nested checkpoint-state copy', () => {
	const writer = source(database + 'HistoryArchiveObjectLeaseWrite.ts');
	const update = writer.slice(writer.indexOf('), updated as ( update "history_archive_object_queue" object'));
	assert.ok(update.includes(
		'"verificationFacts" = case when eligible."hasVerificationFacts" then eligible."verificationFacts" else object."verificationFacts" end,'
	), 'the update must preserve the existing facts-write guard');
	assert.ok(update.includes([
		'"completionArchiveMetadata" = case',
		'when object."objectType" = \'checkpoint-state\'',
		'and eligible."hasVerificationFacts"',
		'and jsonb_typeof(eligible."archiveMetadata") = \'object\'',
		'and (eligible."verificationFacts" -> \'checkpointHistoryArchiveState\') = eligible."archiveMetadata"',
		'then null else eligible."archiveMetadata" end,'
	].join(' ')), 'nonmatching, absent and root metadata must retain the existing write');
});

test('checkpoint fanout, proof fallback and root-state persistence keep their distinct readers', () => {
	const proof = source(database + 'HistoryArchiveCheckpointProofRefreshSql.ts');
	assert.ok(proof.includes([
		'coalesce( object."verificationFacts"#>> \'{checkpointHistoryArchiveStateFact,networkPassphrase}\',',
		'object."verificationFacts"#>> \'{checkpointHistoryArchiveState,stellarHistory,networkPassphrase}\',',
		'object."completionArchiveMetadata"#>>\'{stellarHistory,networkPassphrase}\' ) as network_passphrase'
	].join(' ')), 'proof refresh must prefer canonical facts and retain the legacy fallback');
	const completion = source('use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.ts');
	assert.ok(completion.includes('buildObjectsFromCheckpointArchiveMetadata( object, object.verificationFacts )'));
	assert.ok(completion.includes('const value = verificationFacts.checkpointHistoryArchiveState;'));
	assert.ok(completion.includes([
		"object.objectType === 'history-archive-state' && object.completionArchiveMetadata !== null ) {",
		"await this.stateRepository.saveAvailable( object.archiveUrl, object.completionArchiveMetadata, 'history-scanner' );"
	].join(' ')));
});

test('the actual archive metadata validator accepts a complete synthetic nested value', () => {
	const checkpointHistoryArchiveState = {
		stellarHistoryUrl: 'https://archive.example.invalid/history/checkpoint.json',
		observedAt: '2025-01-01T00:00:00Z',
		stellarHistory: { version: 1, server: 'fixture', currentLedger: 63, currentBuckets: [] }
	};
	assert.equal(isArchiveMetadataDTO(checkpointHistoryArchiveState), true);
	assert.equal(isArchiveMetadataDTO({ ...checkpointHistoryArchiveState, stellarHistory: null }), false);
});
