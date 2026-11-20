import {
	EmailRateLimitError,
	WeeklyEmailGate,
	reserveWeeklyEmailSql
} from '../WeeklyEmailGate.js';

// SQL seam only: no database service, transport, credentials or application clock.
function fixture() {
	let databaseTime = 0;
	const rows = new Map<string, { token: string; next: number }>();
	const query = jest.fn(async (sql: string, [key, token]: string[]) => {
		if (sql.startsWith('DELETE')) {
			if (rows.get(key)?.token === token) rows.delete(key);
			return [];
		}
		expect(sql).toBe(reserveWeeklyEmailSql);
		if ((rows.get(key)?.next ?? -1) > databaseTime) return [];
		rows.set(key, { token, next: databaseTime + 168 * 60 * 60 * 1000 });
		return [{ recipient_key: key }];
	});
	return {
		query,
		gate: new WeeklyEmailGate(query),
		advance: (ms: number) => {
			databaseTime += ms;
		}
	};
}

it('reserves a first send, refuses all types/roots until exactly seven days and survives service recreation', async () => {
	const f = fixture(),
		recipient = 'subscriber:fixture';
	await f.gate.reserve(recipient);
	f.advance(168 * 60 * 60 * 1000 - 1);
	await expect(
		new WeeklyEmailGate(f.query).reserve(recipient)
	).rejects.toBeInstanceOf(EmailRateLimitError);
	f.advance(1);
	await expect(
		new WeeklyEmailGate(f.query).reserve(recipient)
	).resolves.toEqual(expect.any(String));
	expect(reserveWeeklyEmailSql).toMatch(
		/ON CONFLICT \(recipient_key\) DO UPDATE/
	);
	expect(reserveWeeklyEmailSql).toMatch(
		/next_allowed_at <= statement_timestamp\(\)/
	);
});

it('permits only one concurrent attempt across independent workers', async () => {
	const f = fixture();
	const results = await Promise.allSettled(
		Array.from({ length: 12 }, () =>
			new WeeklyEmailGate(f.query).reserve('subscriber:fixture')
		)
	);
	expect(
		results.filter((result) => result.status === 'fulfilled')
	).toHaveLength(1);
	expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
		11
	);
});

it('releases a definitive rejection but cannot release a newer attempt with an old token', async () => {
	const f = fixture(),
		key = 'subscriber:fixture';
	const first = await f.gate.reserve(key);
	await f.gate.releaseRejected(key, first);
	await f.gate.reserve(key);
	await f.gate.releaseRejected(key, first);
	await expect(f.gate.reserve(key)).rejects.toBeInstanceOf(EmailRateLimitError);
});

it('fails closed for missing storage or malformed results', async () => {
	await expect(
		new WeeklyEmailGate(async () => {
			throw new Error('offline');
		}).reserve('fixture')
	).rejects.toThrow('offline');
	await expect(
		new WeeklyEmailGate(async () => undefined).reserve('fixture')
	).rejects.toThrow('Invalid email gate response');
});
