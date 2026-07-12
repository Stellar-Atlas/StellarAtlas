import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArchiveEvidenceCursorKeys } from './check-archive-evidence-cursor-keys.mjs';

const encodedKey = (byte) => Buffer.alloc(32, byte).toString('base64url');

test('accepts an ordered rotation key ring', () => {
	assert.equal(
		validateArchiveEvidenceCursorKeys(
			`active:${encodedKey(1)},retiring:${encodedKey(2)}`
		),
		2
	);
});

test('rejects missing, placeholder, short, and duplicate keys', () => {
	assert.throws(() => validateArchiveEvidenceCursorKeys(undefined));
	assert.throws(() => validateArchiveEvidenceCursorKeys('active:REPLACE_ME'));
	assert.throws(() => validateArchiveEvidenceCursorKeys('active:YQ'));
	assert.throws(() =>
		validateArchiveEvidenceCursorKeys(
			`active:${encodedKey(1)},active:${encodedKey(2)}`
		)
	);
});
