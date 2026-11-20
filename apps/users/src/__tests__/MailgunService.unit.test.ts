import { jest } from '@jest/globals';
import { WeeklyEmailGate } from 'shared/lib/email/WeeklyEmailGate.js';

const post = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule('axios', () => ({
	default: {
		post,
		CancelToken: { source: () => ({ token: 'fixture', cancel: jest.fn() }) },
		isAxiosError: (value: unknown) =>
			value instanceof Error && 'isAxiosError' in value
	},
	AxiosError: {
		ECONNABORTED: 'ECONNABORTED',
		ETIMEDOUT: 'ETIMEDOUT',
		ERR_CANCELED: 'ERR_CANCELED'
	}
}));
const { MailgunService, HttpError } = await import('../MailgunService.js');

function fixture() {
	const reservations = new Map<string, string>();
	const query = jest.fn(async (sql: string, [key, token]: string[]) => {
		if (sql.startsWith('DELETE')) {
			if (reservations.get(key) === token) reservations.delete(key);
			return [];
		}
		if (reservations.has(key)) return [];
		reservations.set(key, token);
		return [{ recipient_key: key }];
	});
	const gate = new WeeklyEmailGate(query);
	const service = new MailgunService(
		'fixture-secret',
		'sender@example.test',
		'https://provider.invalid',
		gate
	);
	const send = () =>
		service.sendMessage(
			'recipient@example.test',
			'body',
			'subject',
			'subscriber-fixture'
		);
	return { gate, service, send, query };
}

beforeEach(() => {
	post.mockReset();
	post.mockResolvedValue({
		status: 200,
		data: {},
		statusText: 'Accepted',
		headers: {}
	});
});

it('sends once across concurrent HTTP retries and keeps the same shared SMTP subscriber key', async () => {
	const f = fixture();
	const results = await Promise.all([f.send(), f.send()]);
	expect(
		results.filter((result) => !(result instanceof HttpError))
	).toHaveLength(1);
	expect(post).toHaveBeenCalledTimes(1);
	expect(f.query.mock.calls[0][1][0]).toBe('subscriber:subscriber-fixture');
	// This is the exact key used by LocalSMTPUserService on the shared database.
	await expect(f.gate.reserve('subscriber:subscriber-fixture')).rejects.toThrow(
		'seven days'
	);
});

it('does not report a definitive 403 as delivered and permits repair without waiting a week', async () => {
	const f = fixture();
	post.mockRejectedValueOnce(
		Object.assign(new Error('refused'), {
			isAxiosError: true,
			response: { status: 403 }
		})
	);
	const rejected = await f.send();
	expect(rejected).toBeInstanceOf(HttpError);
	expect(rejected instanceof HttpError && rejected.response?.status).toBe(403);
	expect(await f.send()).not.toBeInstanceOf(HttpError);
	expect(post).toHaveBeenCalledTimes(2);
});

it.each([
	{ code: 'ETIMEDOUT' },
	{ response: { status: 408 } },
	{ response: { status: 503 } }
])(
	'keeps ambiguous outcomes reserved across a service restart: %s',
	async (outcome) => {
		const f = fixture();
		post.mockRejectedValueOnce(
			Object.assign(new Error('unknown'), { isAxiosError: true, ...outcome })
		);
		expect(await f.send()).toBeInstanceOf(HttpError);
		const restarted = new MailgunService(
			'fixture-secret',
			'sender@example.test',
			'https://provider.invalid',
			new WeeklyEmailGate(f.query)
		);
		const result = await restarted.sendMessage(
			'recipient@example.test',
			'other root',
			'confirmation',
			'subscriber-fixture'
		);
		expect(result instanceof HttpError && result.code).toBe('EMAIL_RATE_LIMIT');
		expect(post).toHaveBeenCalledTimes(1);
	}
);

it('never calls the provider when gate persistence fails', async () => {
	const service = new MailgunService(
		'fixture-secret',
		'sender@example.test',
		'https://provider.invalid',
		new WeeklyEmailGate(async () => {
			throw new Error('offline');
		})
	);
	const result = await service.sendMessage(
		'recipient@example.test',
		'body',
		'subject',
		'subscriber-fixture'
	);
	expect(result instanceof HttpError && result.code).toBe(
		'EMAIL_GATE_UNAVAILABLE'
	);
	expect(post).not.toHaveBeenCalled();
});
