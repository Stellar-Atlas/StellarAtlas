import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { verificationReturnedRows } from './VerificationSqlRows.js';
import {
	DeveloperSubmissionError,
	developerSubmissionRetentionDays,
	type DeveloperSubmission,
	type DeveloperSubmissionInput,
	type DeveloperSubmissionResult,
	type DeveloperSubmissionStore
} from './DeveloperSubmission.js';

interface SubmissionRow {
	readonly id: string;
	readonly created_at: Date;
	readonly expires_at: Date;
	readonly network_passphrase: string;
	readonly request: DeveloperSubmissionInput;
	readonly status: DeveloperSubmission['status'];
	readonly result: DeveloperSubmissionResult | null;
}

function ownerId(subjectId: string): string {
	const match = /^github:([1-9][0-9]{0,15})$/.exec(subjectId);
	if (!match) throw new DeveloperSubmissionError(401, 'sign_in_required');
	return match[1]!;
}

export class TypeOrmDeveloperSubmissionStore implements DeveloperSubmissionStore {
	private inFlight = 0;

	constructor(private readonly database: DataSource) {}

	async assertReady(): Promise<void> {
		await this.transaction(false, async (manager) => {
			const [row] = await manager.query<{ ready: boolean }[]>(`
				SELECT has_table_privilege('atlas_developer_submission', 'SELECT')
					AND has_table_privilege('atlas_developer_submission', 'INSERT')
					AND has_table_privilege('atlas_developer_submission', 'UPDATE')
					AND has_table_privilege('atlas_developer_submission', 'DELETE') AS ready
			`);
			if (row?.ready !== true)
				throw new Error('Developer submission storage unavailable');
			await manager.query(`
				SELECT id,user_id,idempotency_key,network_passphrase,request,status,result,created_at,expires_at
				FROM atlas_developer_submission LIMIT 0
			`);
		});
	}

	async create(
		subjectId: string,
		key: string,
		input: DeveloperSubmissionInput,
		networkPassphrase: string
	): Promise<{
		readonly created: boolean;
		readonly submission: DeveloperSubmission;
	}> {
		const userId = ownerId(subjectId);
		return this.transaction(false, async (manager) => {
			await manager.query(
				"SELECT pg_advisory_xact_lock(hashtextextended('atlas-developer-submission',0))"
			);
			await manager.query(`
				DELETE FROM atlas_developer_submission WHERE id IN (
					SELECT id FROM atlas_developer_submission
					WHERE status<>'checking' AND expires_at<=clock_timestamp()
					ORDER BY expires_at LIMIT 200
				)
			`);
			const existing = await manager.query<SubmissionRow[]>(
				`
				SELECT * FROM atlas_developer_submission WHERE user_id=$1 AND idempotency_key=$2
					AND (status='checking' OR expires_at>clock_timestamp())
			`,
				[userId, key]
			);
			if (existing[0]) {
				const value = existing[0];
				if (
					value.network_passphrase !== networkPassphrase ||
					value.request.contractId !== input.contractId ||
					value.request.repository !== input.repository ||
					value.request.commit !== input.commit
				)
					throw new DeveloperSubmissionError(409, 'idempotency_conflict');
				return { created: false, submission: project(value) };
			}
			// A durable active row owns this contract check across serving processes.
			// Only settlement releases it. Age or another idempotency key cannot.
			const pending = await manager.query<{ id: string }[]>(
				`
				SELECT id FROM atlas_developer_submission
				WHERE network_passphrase=$1 AND request->>'contractId'=$2 AND status='checking'
				LIMIT 1
			`,
				[networkPassphrase, input.contractId]
			);
			if (pending.length)
				throw new DeveloperSubmissionError(429, 'submission_busy');
			const [budget] = await manager.query<{ full: boolean }[]>(
				`
				SELECT
					(SELECT count(*)>=10000 FROM atlas_developer_submission)
					OR (SELECT count(*)>=100 FROM atlas_developer_submission WHERE user_id=$1)
					OR (SELECT count(*)>=30 FROM atlas_developer_submission
						WHERE created_at>clock_timestamp()-interval '1 minute')
					OR (SELECT count(*)>=5 FROM atlas_developer_submission
						WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 minute') AS full
			`,
				[userId]
			);
			if (budget?.full !== false)
				throw new DeveloperSubmissionError(429, 'submission_busy');
			const rows = await manager.query<SubmissionRow[]>(
				`
				INSERT INTO atlas_developer_submission
					(id,user_id,idempotency_key,network_passphrase,request,status,expires_at)
				VALUES ($1,$2,$3,$4,$5::jsonb,'checking',
					clock_timestamp()+make_interval(days=>$6))
				RETURNING *
			`,
				[
					randomUUID(),
					userId,
					key,
					networkPassphrase,
					JSON.stringify(input),
					developerSubmissionRetentionDays
				]
			);
			if (!rows[0]) throw new Error('Developer submission was not saved');
			return { created: true, submission: project(rows[0]) };
		});
	}

	async read(
		subjectId: string,
		id: string
	): Promise<DeveloperSubmission | null> {
		const userId = ownerId(subjectId);
		return this.transaction(true, async (manager) => {
			const rows = await manager.query<SubmissionRow[]>(
				`
				SELECT * FROM atlas_developer_submission
				WHERE id=$1 AND user_id=$2
					AND (status='checking' OR expires_at>clock_timestamp())
			`,
				[id, userId]
			);
			return rows[0] ? project(rows[0]) : null;
		});
	}

	async finish(
		subjectId: string,
		id: string,
		result: DeveloperSubmissionResult
	): Promise<DeveloperSubmission> {
		const userId = ownerId(subjectId);
		const encoded = JSON.stringify(result);
		if (Buffer.byteLength(encoded) > 16 * 1024)
			throw new Error('Developer submission result exceeds its limit');
		return this.transaction(false, async (manager) => {
			const rows = verificationReturnedRows(
				await manager.query<unknown>(
					`
				UPDATE atlas_developer_submission SET status=$3, result=$4::jsonb,
					expires_at=clock_timestamp()+make_interval(days=>$5)
				WHERE id=$1 AND user_id=$2 AND status='checking'
				RETURNING *
			`,
					[
						id,
						userId,
						result.status === 'unavailable' ? 'unavailable' : 'completed',
						encoded,
						developerSubmissionRetentionDays
					]
				)
			);
			const value = rows[0] as unknown as SubmissionRow | undefined;
			if (!value)
				throw new Error('Developer submission could not be completed');
			return project(value);
		});
	}

	private async transaction<T>(
		readOnly: boolean,
		run: (manager: EntityManager) => Promise<T>
	): Promise<T> {
		if (this.inFlight >= 4)
			throw new DeveloperSubmissionError(429, 'submission_busy');
		this.inFlight++;
		try {
			return await this.database.transaction(async (manager) => {
				if (readOnly) await manager.query('SET TRANSACTION READ ONLY');
				else {
					const [mode] = await manager.query<
						{ transaction_read_only: string }[]
					>('SHOW transaction_read_only');
					if (mode?.transaction_read_only !== 'off')
						throw new Error('Developer submissions require writable storage');
				}
				await manager.query("SET LOCAL lock_timeout='1s'");
				await manager.query("SET LOCAL statement_timeout='2s'");
				return run(manager);
			});
		} finally {
			this.inFlight--;
		}
	}
}

function project(row: SubmissionRow): DeveloperSubmission {
	return {
		id: row.id,
		submittedAt: row.created_at.toISOString(),
		expiresAt: row.expires_at.toISOString(),
		networkPassphrase: row.network_passphrase,
		request: row.request,
		status: row.status,
		result: row.result,
		contractOwnership: 'not_assessed',
		independentReproduction: 'not_assessed',
		securityAudit: 'not_assessed'
	};
}
