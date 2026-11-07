import type { DataSource, EntityManager } from 'typeorm';
import {
	VerificationError,
	type Application,
	type Network
} from './VerificationApplication.js';
import type {
	ApplicationEvent,
	VerificationStore
} from './VerificationWorkflow.js';

export class TypeOrmVerificationStore implements VerificationStore {
	constructor(private readonly database: DataSource) {}
	async find(id: string): Promise<Application | null> {
		const rows = await this.database.query<{ payload: Application }[]>(
			'SELECT payload FROM atlas_verification_application WHERE id = $1',
			[id]
		);
		return rows[0]?.payload ?? null;
	}
	async create(
		application: Application,
		event: ApplicationEvent
	): Promise<void> {
		try {
			await this.database.transaction(async (manager) => {
				await manager.query("SET LOCAL lock_timeout = '2s'");
				await manager.query("SET LOCAL statement_timeout = '5s'");
				// Cluster-wide admission for this authenticated applicant; no process-local lock.
				await manager.query(
					'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
					['atlas-verification:' + application.applicantId]
				);
				const rows = await manager.query<{ count: number }[]>(
					`SELECT count(*)::int AS count
					FROM atlas_verification_application WHERE applicant_id = $1
					AND created_at >= $2::timestamptz - interval '1 day'`,
					[application.applicantId, application.submittedAt]
				);
				if ((rows[0]?.count ?? 0) >= 5)
					throw new VerificationError(409, 'Daily application limit reached');
				await manager.query(
					`INSERT INTO atlas_verification_application
					(id, applicant_id, network, address, state, revision, created_at, payload)
					VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
					this.parameters(application)
				);
				await this.event(manager, event);
			});
		} catch (error) {
			this.conflict(error);
		}
	}
	async update(
		expectedRevision: number,
		application: Application,
		event: ApplicationEvent
	): Promise<void> {
		try {
			await this.database.transaction(async (manager) => {
				await manager.query("SET LOCAL lock_timeout = '2s'");
				await manager.query("SET LOCAL statement_timeout = '5s'");
				const rows = await manager.query<{ id: string }[]>(
					`UPDATE atlas_verification_application
					SET state=$2, revision=$3, payload=$4::jsonb
					WHERE id=$1 AND revision=$5 RETURNING id`,
					[
						application.id,
						application.state,
						application.revision,
						JSON.stringify(application),
						expectedRevision
					]
				);
				if (rows.length !== 1)
					throw new VerificationError(
						409,
						'Application changed; reload before deciding'
					);
				await this.event(manager, event);
			});
		} catch (error) {
			this.conflict(error);
		}
	}
	async queue(after: string, limit: number): Promise<readonly Application[]> {
		const rows = await this.database.query<{ payload: Application }[]>(
			`SELECT payload
			FROM atlas_verification_application WHERE state='pending' AND id > $1::uuid
			ORDER BY id LIMIT $2`,
			[after || '00000000-0000-0000-0000-000000000000', Math.min(20, limit)]
		);
		return rows.map((row) => row.payload);
	}
	async approved(
		network: Network,
		address: string
	): Promise<Application | null> {
		const rows = await this.database.query<{ payload: Application }[]>(
			`SELECT payload
			FROM atlas_verification_application WHERE network=$1 AND address=$2 AND state='approved' LIMIT 1`,
			[network, address]
		);
		return rows[0]?.payload ?? null;
	}
	private event(
		manager: EntityManager,
		event: ApplicationEvent
	): Promise<unknown> {
		return manager.query(
			`INSERT INTO atlas_verification_event (application_id, revision, event)
			VALUES ($1,$2,$3::jsonb)`,
			[event.application.id, event.application.revision, JSON.stringify(event)]
		);
	}
	private parameters(application: Application): unknown[] {
		return [
			application.id,
			application.applicantId,
			application.network,
			application.address,
			application.state,
			application.revision,
			application.submittedAt,
			JSON.stringify(application)
		];
	}
	private conflict(error: unknown): never {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === '23505'
		)
			throw new VerificationError(
				409,
				'An application or approved identity already exists for this account'
			);
		throw error;
	}
}
