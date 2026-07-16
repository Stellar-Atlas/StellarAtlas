import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

export interface CanonicalProofFixture {
	readonly ledgerDigest: Buffer;
	readonly ledgerRemoteId: string;
}

export interface CanonicalBatchFixtureInput {
	readonly batchId: string;
	readonly checkpointLedger: number;
	readonly firstLedger: number;
	readonly label: string;
	readonly lastLedger: number;
	readonly networkHash: Buffer;
	readonly networkPassphrase: string;
	readonly proofTime: Date;
	readonly proofVersion: number;
}

interface SourceFixture {
	readonly digest: Buffer;
	readonly objectType: string;
	readonly remoteId: string;
	readonly representation: string;
}

export async function insertCanonicalBatchFixture(
	dataSource: DataSource,
	input: CanonicalBatchFixtureInput
): Promise<CanonicalProofFixture> {
	const archiveUrlIdentity = `https://${input.label}.example/history`;
	const sources = {
		checkpointState: source(input.label, 'checkpoint-state', 'canonical-json'),
		ledger: source(input.label, 'ledger', 'uncompressed-xdr'),
		results: source(input.label, 'results', 'uncompressed-xdr'),
		transactions: source(input.label, 'transactions', 'uncompressed-xdr')
	};
	for (const value of Object.values(sources)) {
		await dataSource.query(
			`insert into "history_archive_object_queue" (
				"remoteId", "archiveUrlIdentity", "checkpointLedger",
				"objectType", status, "verificationFacts"
			) values ($1, $2, $3, $4, 'verified', $5::jsonb)`,
			[
				value.remoteId,
				archiveUrlIdentity,
				input.checkpointLedger,
				value.objectType,
				JSON.stringify({
					content: {
						algorithm: 'sha256',
						digest: value.digest.toString('hex'),
						representation: value.representation
					}
				})
			]
		);
	}
	const [proof] = await dataSource.query<Array<{ readonly id: string }>>(
		`insert into "history_archive_checkpoint_proof" (
			"archiveUrlIdentity", "checkpointLedger", status, "proofVersion",
			"requiredObjectsComplete", "proofFactsComplete",
			"checkpointBucketListMatches", "transactionsMatch", "resultsMatch",
			"previousLedgersMatch", "bucketsVerified", "ledgerFactCount",
			"transactionFactCount", "resultFactCount",
			"checkpointStateObjectRemoteId", "ledgerObjectRemoteId",
			"transactionsObjectRemoteId", "resultsObjectRemoteId",
			"failureKind", details, "evaluatedAt"
		) values (
			$1, $2, 'verified', $3, true, true, true, true, true, true, true,
			$4, $4, $4, $5, $6, $7, $8, null, $9::jsonb, $10
		) returning id::text as id`,
		[
			archiveUrlIdentity,
			input.checkpointLedger,
			input.proofVersion,
			input.checkpointLedger === 63 ? 63 : 64,
			sources.checkpointState.remoteId,
			sources.ledger.remoteId,
			sources.transactions.remoteId,
			sources.results.remoteId,
			JSON.stringify({
				checkpointStateLedgerFactPresent: true,
				checkpointStateLedgerMatches: true,
				networkPassphrase: input.networkPassphrase
			}),
			input.proofTime
		]
	);
	if (proof === undefined) throw new Error('Expected checkpoint proof id');
	await dataSource.query(
		`insert into "full_history_ingestion_batch" (
			id, "network_passphrase_hash", "checkpoint_proof_id", "proof_version",
			"proof_evaluated_at", "archive_url_identity", "checkpoint_ledger",
			"first_ledger", "last_ledger", "checkpoint_state_object_remote_id",
			"checkpoint_state_content_digest", "ledger_object_remote_id",
			"ledger_content_digest", "transactions_object_remote_id",
			"transactions_content_digest", "results_object_remote_id",
			"results_content_digest"
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
			$14, $15, $16, $17)`,
		[
			input.batchId,
			input.networkHash,
			proof.id,
			input.proofVersion,
			input.proofTime,
			archiveUrlIdentity,
			input.checkpointLedger,
			input.firstLedger,
			input.lastLedger,
			sources.checkpointState.remoteId,
			sources.checkpointState.digest,
			sources.ledger.remoteId,
			sources.ledger.digest,
			sources.transactions.remoteId,
			sources.transactions.digest,
			sources.results.remoteId,
			sources.results.digest
		]
	);
	return {
		ledgerDigest: sources.ledger.digest,
		ledgerRemoteId: sources.ledger.remoteId
	};
}

function source(
	label: string,
	objectType: string,
	representation: string
): SourceFixture {
	return {
		digest: createHash('sha256').update(`${label}:${objectType}`).digest(),
		objectType,
		remoteId: randomUUID(),
		representation
	};
}
