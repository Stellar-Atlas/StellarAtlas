import { createHmac } from 'node:crypto';
import {
	encodeArchiveEvidenceCursor,
	InvalidArchiveEvidenceCursorError,
	normalizeArchiveEvidencePages
} from '../ArchiveEvidencePagination.js';
import {
	ArchiveEvidenceCursorCodec,
	createArchiveEvidenceCursorCodec
} from '../ArchiveEvidenceCursorCodec.js';

const remoteId = '11111111-1111-4111-8111-111111111111';
const rowAt = new Date('2026-07-10T00:00:00.000Z');
const snapshotAt = new Date('2026-07-10T00:01:00.000Z');
const codec = createCodec('active', 1);

describe('ArchiveEvidencePagination', () => {
	it('binds live keyset cursors to kind and normalized filters only', () => {
		const filters = {
			archiveUrlIdentity: 'https://history.example.com',
			objectType: 'bucket' as const,
			status: 'failed' as const
		};
		const cursor = encodeArchiveEvidenceCursor(
			codec,
			'objects',
			filters,
			{ at: rowAt, remoteId },
			[]
		);
		const evaluatedAt = new Date('2026-07-10T00:02:00.000Z');

		const pages = normalizeArchiveEvidencePages(
			{
				archiveUrl: 'https://history.example.com/',
				objectCursor: cursor,
				objectStatus: 'failed',
				objectType: 'bucket'
			},
			codec,
			null,
			[],
			evaluatedAt
		);

		expect(pages.objectPage).toMatchObject({
			before: { at: rowAt, remoteId },
			snapshotAt: evaluatedAt,
			snapshotTotal: null
		});
		const encodedPayload = cursor.split('.')[1];
		expect(encodedPayload).toBeDefined();
		const payload = JSON.parse(
			Buffer.from(encodedPayload!, 'base64url').toString('utf8')
		) as Record<string, unknown>;
		expect(payload).toMatchObject({ v: 2 });
		expect(payload).not.toHaveProperty('s');
		expect(payload).not.toHaveProperty('t');
	});

	it('accepts previously issued v1 frozen-snapshot cursors as live positions', () => {
		const current = objectCursor(codec, []);
		const [keyId, encodedPayload] = current.split('.');
		if (keyId === undefined || encodedPayload === undefined) {
			throw new Error('Expected signed cursor parts');
		}
		const payload = JSON.parse(
			Buffer.from(encodedPayload, 'base64url').toString('utf8')
		) as Record<string, unknown>;
		const legacyPayload = Buffer.from(
			JSON.stringify({
				...payload,
				s: snapshotAt.getTime(),
				t: 42,
				v: 1
			})
		).toString('base64url');
		const signature = createHmac('sha256', Buffer.alloc(32, 1))
			.update(`${keyId}.${legacyPayload}`)
			.digest('base64url');
		const legacyCursor = `${keyId}.${legacyPayload}.${signature}`;
		const evaluatedAt = new Date('2026-07-10T00:03:00.000Z');

		const page = normalizeArchiveEvidencePages(
			{
				objectCursor: legacyCursor,
				objectStatus: 'failed',
				objectType: 'bucket'
			},
			codec,
			null,
			[],
			evaluatedAt
		).objectPage;

		expect(page.before).toEqual({ at: rowAt, remoteId });
		expect(page.snapshotAt).toEqual(evaluatedAt);
		expect(page.snapshotTotal).toBeNull();
	});

	it('rejects filter changes and signature tampering', () => {
		const cursor = objectCursor(codec, []);
		const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`;

		expect(() =>
			normalizeArchiveEvidencePages(
				{
					objectCursor: cursor,
					objectStatus: 'verified',
					objectType: 'bucket'
				},
				codec
			)
		).toThrow(InvalidArchiveEvidenceCursorError);
		expect(() =>
			normalizeArchiveEvidencePages(
				{
					objectCursor: tampered,
					objectStatus: 'failed',
					objectType: 'bucket'
				},
				codec
			)
		).toThrow(InvalidArchiveEvidenceCursorError);
	});

	it('keeps a 79-root cursor compact and binds its root fingerprint', () => {
		const roots = Array.from(
			{ length: 79 },
			(_, index) => `https://history-${index.toString()}.example.com`
		);
		const cursor = objectCursor(codec, roots);

		expect(cursor.length).toBeLessThan(300);
		expect(
			normalizeArchiveEvidencePages(
				{
					objectCursor: cursor,
					objectStatus: 'failed',
					objectType: 'bucket'
				},
				codec,
				null,
				roots
			).objectPage.before
		).toEqual({ at: rowAt, remoteId });
		expect(() =>
			normalizeArchiveEvidencePages(
				{
					objectCursor: cursor,
					objectStatus: 'failed',
					objectType: 'bucket'
				},
				codec,
				null,
				roots.slice(1)
			)
		).toThrow(InvalidArchiveEvidenceCursorError);
	});

	it('verifies old cursors after key rotation and signs with the first key', () => {
		const oldCodec = createCodec('old', 2);
		const oldCursor = objectCursor(oldCodec, []);
		const rotatedCodec = createArchiveEvidenceCursorCodec({
			encodedKeys: `${encodedKey('new', 3)},${encodedKey('old', 2)}`,
			nodeEnv: 'test'
		});

		expect(
			normalizeArchiveEvidencePages(
				{
					objectCursor: oldCursor,
					objectStatus: 'failed',
					objectType: 'bucket'
				},
				rotatedCodec
			).objectPage.before
		).not.toBeNull();
		expect(objectCursor(rotatedCodec, []).startsWith('new.')).toBe(true);
	});

	it('requires configured keys in production', () => {
		expect(() =>
			createArchiveEvidenceCursorCodec({ nodeEnv: 'production' })
		).toThrow('ARCHIVE_EVIDENCE_CURSOR_KEYS');
	});

	it('bounds every page and copy sample', () => {
		const pages = normalizeArchiveEvidencePages(
			{
				copyLimit: 999,
				eventLimit: 999,
				failureLimit: 999,
				objectLimit: 999,
				workerIssueLimit: 999
			},
			codec
		);

		expect(pages.copyLimit).toBe(10);
		expect(pages.eventPage.limit).toBe(250);
		expect(pages.objectPage.limit).toBe(250);
		expect(pages.remoteFailures.limit).toBe(250);
		expect(pages.workerIssues.limit).toBe(250);
	});
});

function objectCursor(
	cursorCodec: ArchiveEvidenceCursorCodec,
	roots: readonly string[]
): string {
	return encodeArchiveEvidenceCursor(
		cursorCodec,
		'objects',
		{
			archiveUrlIdentity: null,
			objectType: 'bucket',
			status: 'failed'
		},
		{ at: rowAt, remoteId },
		roots
	);
}

function createCodec(id: string, byte: number): ArchiveEvidenceCursorCodec {
	return createArchiveEvidenceCursorCodec({
		encodedKeys: encodedKey(id, byte),
		nodeEnv: 'test'
	});
}

function encodedKey(id: string, byte: number): string {
	return `${id}:${Buffer.alloc(32, byte).toString('base64url')}`;
}
