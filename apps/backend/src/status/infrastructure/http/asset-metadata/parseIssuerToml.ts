import * as toml from 'toml';
import type { CurrencyEntry } from './types.js';

const reserved = new Set(['CURRENCIES', 'NETWORK_PASSPHRASE']);

export interface ParsedIssuerToml {
	readonly currencies: readonly CurrencyEntry[];
	readonly fields: Readonly<Record<string, string>>;
	readonly networkPassphrase: string | null;
}

export function parseIssuerToml(source: string): ParsedIssuerToml {
	if (Buffer.byteLength(source, 'utf8') > 100 * 1024) {
		throw new Error('Issuer TOML exceeds 100 KiB');
	}
	const parsed: unknown = toml.parse(source);
	if (!isRecord(parsed)) throw new Error('Issuer TOML root must be a table');
	const currenciesValue: unknown = parsed.CURRENCIES;
	const rows = Array.isArray(currenciesValue)
		? currenciesValue
		: isRecord(currenciesValue)
			? [currenciesValue]
			: [];
	const currencies = rows.filter(isRecord).map(parseCurrency);
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (reserved.has(key)) continue;
		const scalar = toRawText(value);
		if (scalar !== null) fields[key] = scalar;
	}
	if (isRecord(parsed.DOCUMENTATION)) {
		for (const [key, value] of Object.entries(parsed.DOCUMENTATION)) {
			if (!key.startsWith('ORG_')) continue;
			const scalar = toRawText(value);
			if (scalar !== null) fields[`DOCUMENTATION.${key}`] = scalar;
		}
	}
	return {
		currencies,
		fields,
		networkPassphrase: toText(parsed.NETWORK_PASSPHRASE)
	};
}

function parseCurrency(row: Record<string, unknown>): CurrencyEntry {
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(row)) {
		const scalar = toRawText(value);
		if (scalar !== null) fields[key] = scalar;
	}
	return {
		code: toText(row.code),
		issuer: toText(row.issuer),
		contract: toText(row.contract) ?? toText(row.contract_id),
		name: toText(row.name),
		description: toText(row.desc) ?? toText(row.description),
		image: toText(row.image),
		fields
	};
}

function toRawText(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return null;
}

function toText(value: unknown): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
