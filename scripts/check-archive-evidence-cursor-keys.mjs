#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const variableName = 'ARCHIVE_EVIDENCE_CURSOR_KEYS';

export function validateArchiveEvidenceCursorKeys(value) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${variableName} is required`);
	}
	const seen = new Set();
	const entries = value.split(',');
	for (const entry of entries) {
		const separator = entry.indexOf(':');
		const id = separator < 0 ? '' : entry.slice(0, separator).trim();
		const encodedSecret =
			separator < 0 ? '' : entry.slice(separator + 1).trim();
		if (!/^[A-Za-z0-9_-]{1,24}$/.test(id) || seen.has(id)) {
			throw new Error('Cursor key ids must be unique base64url labels');
		}
		seen.add(id);
		const secret = Buffer.from(encodedSecret, 'base64url');
		if (
			secret.length !== 32 ||
			secret.toString('base64url') !== encodedSecret
		) {
			throw new Error(
				'Each cursor secret must be canonical base64url for 32 bytes'
			);
		}
	}
	return entries.length;
}

function readConfiguredValue(args) {
	if (args.length === 1 && args[0] === '--environment') {
		return process.env[variableName];
	}
	if (args.length === 2 && args[0] === '--env-file') {
		const values = parse(readFileSync(resolve(args[1]), 'utf8'));
		return values[variableName];
	}
	throw new Error(
		'Usage: check-archive-evidence-cursor-keys.mjs --environment | --env-file PATH'
	);
}

function main() {
	try {
		const count = validateArchiveEvidenceCursorKeys(
			readConfiguredValue(process.argv.slice(2))
		);
		console.log(
			`Archive evidence cursor configuration is valid (${count} keys)`
		);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'validation failed';
		console.error(
			`Archive evidence cursor configuration is invalid: ${message}`
		);
		process.exitCode = 1;
	}
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
