import { randomUUID } from 'node:crypto';

export class EmailRateLimitError extends Error {
	constructor() {
		super('At most one email per subscriber is permitted every seven days');
		this.name = 'EmailRateLimitError';
	}
}

export type EmailGateQuery = (
	sql: string,
	parameters: string[]
) => Promise<unknown>;

// One committed statement, keyed by recipient/subscriber rather than subscription
// or message type. PostgreSQL serializes conflicting inserts/updates across workers.
export const reserveWeeklyEmailSql = `
	INSERT INTO email_delivery_gate (recipient_key, next_allowed_at, attempt_token)
	VALUES ($1, statement_timestamp() + interval '168 hours', $2)
	ON CONFLICT (recipient_key) DO UPDATE
	SET next_allowed_at = EXCLUDED.next_allowed_at, attempt_token = EXCLUDED.attempt_token
	WHERE email_delivery_gate.next_allowed_at <= statement_timestamp()
	RETURNING recipient_key`;

export class WeeklyEmailGate {
	constructor(private readonly query: EmailGateQuery) {}

	async reserve(recipientKey: string): Promise<string> {
		if (!recipientKey) throw new Error('Email gate requires a recipient key');
		const attemptToken = randomUUID();
		const rows = await this.query(reserveWeeklyEmailSql, [
			recipientKey,
			attemptToken
		]);
		if (!Array.isArray(rows)) throw new Error('Invalid email gate response');
		if (rows.length === 0) throw new EmailRateLimitError();
		return attemptToken;
	}

	// Only an explicit transport refusal permits release. A timeout, crash or
	// unknown result keeps its durable window. The token fences stale completions.
	async releaseRejected(
		recipientKey: string,
		attemptToken: string
	): Promise<void> {
		await this.query(
			'DELETE FROM email_delivery_gate WHERE recipient_key = $1 AND attempt_token = $2',
			[recipientKey, attemptToken]
		);
	}
}
