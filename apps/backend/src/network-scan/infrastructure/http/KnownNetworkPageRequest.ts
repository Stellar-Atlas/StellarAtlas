import type { Request } from 'express';
import {
	knownNetworkDefaultPageSize,
	knownNetworkMaxOffset,
	knownNetworkMaxPageSize,
	type KnownNetworkPageRequest,
	type KnownNodeScope,
	type KnownOrganizationScope
} from '../../use-cases/known-network-scope/KnownNetworkScope.js';

const nodeScopes: readonly KnownNodeScope[] = [
	'current-validator',
	'listener',
	'public-key-only',
	'archived',
	'all-known'
];
const organizationScopes: readonly KnownOrganizationScope[] = [
	'current',
	'archived',
	'all-known'
];

export function parseKnownNodesPageRequest(
	req: Request
): KnownNetworkPageRequest<KnownNodeScope> | null {
	return parsePageRequest(req, nodeScopes, 'all-known');
}

export function parseKnownOrganizationsPageRequest(
	req: Request
): KnownNetworkPageRequest<KnownOrganizationScope> | null {
	return parsePageRequest(req, organizationScopes, 'all-known');
}

function parsePageRequest<Scope extends string>(
	req: Request,
	validScopes: readonly Scope[],
	defaultScope: Scope
): KnownNetworkPageRequest<Scope> | null {
	if (
		!isOptionalSingleString(req.query.scope) ||
		!isOptionalSingleString(req.query.q) ||
		!isOptionalSingleString(req.query.limit) ||
		!isOptionalSingleString(req.query.offset)
	) {
		return null;
	}
	const scopeValue = singleString(req.query.scope);
	if (scopeValue !== undefined && !isOneOf(scopeValue, validScopes)) {
		return null;
	}
	const scope = scopeValue ?? defaultScope;

	const limit = parseInteger(
		singleString(req.query.limit),
		knownNetworkDefaultPageSize,
		1,
		knownNetworkMaxPageSize
	);
	const offset = parseInteger(
		singleString(req.query.offset),
		0,
		0,
		knownNetworkMaxOffset
	);
	if (limit === null || offset === null) return null;
	const query = singleString(req.query.q)?.trim() ?? '';
	if (query.length > 128) return null;

	return { limit, offset, query, scope };
}

function isOneOf<Value extends string>(
	value: string,
	validValues: readonly Value[]
): value is Value {
	return validValues.some((validValue) => validValue === value);
}

function singleString(value: Request['query'][string]): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function isOptionalSingleString(value: Request['query'][string]): boolean {
	return value === undefined || typeof value === 'string';
}

function parseInteger(
	value: string | undefined,
	defaultValue: number,
	minimum: number,
	maximum: number
): number | null {
	if (value === undefined) return defaultValue;
	if (!/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
		? parsed
		: null;
}
