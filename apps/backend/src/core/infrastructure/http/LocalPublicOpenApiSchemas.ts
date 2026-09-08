import networkSchema from 'shared/schemas/network.json' with { type: 'json' };
import nodeSchema from 'shared/schemas/node.json' with { type: 'json' };
import nodeSnapshotSchema from 'shared/schemas/node-snapshot.json' with { type: 'json' };
import organizationSchema from 'shared/schemas/organization.json' with { type: 'json' };
import organizationSnapshotSchema from 'shared/schemas/organization-snapshot.json' with { type: 'json' };
import { HistoryArchiveStatusSummaryV1Schema } from 'shared';
import {
	readOpenApiRecord,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';

const schemas = new Map<
	string,
	{ readonly name: string; readonly schema: OpenApiRecord }
>([
	['network.json', { name: 'StellarAtlasNetwork', schema: networkSchema }],
	['node.json', { name: 'StellarAtlasNode', schema: nodeSchema }],
	[
		'node-snapshot.json',
		{ name: 'StellarAtlasNodeSnapshot', schema: nodeSnapshotSchema }
	],
	[
		'organization.json',
		{ name: 'StellarAtlasOrganization', schema: organizationSchema }
	],
	[
		'organization-snapshot.json',
		{
			name: 'StellarAtlasOrganizationSnapshot',
			schema: organizationSnapshotSchema
		}
	]
]);
const pointer = (value: string): string =>
	value.replaceAll('~', '~0').replaceAll('/', '~1');
const unpointer = (value: string): string =>
	value.replaceAll('~1', '/').replaceAll('~0', '~');

/** Embed only checked-in schemas; no network resolver or client-selected location. */
export function withLocalPublicOpenApiSchemas(
	document: unknown
): OpenApiRecord {
	const source = readOpenApiRecord(document);
	if (!source) throw new TypeError('Invalid OpenAPI document');
	const rewritten = rewrite(source) as OpenApiRecord;
	const components = readOpenApiRecord(rewritten.components) ?? {};
	const definitions = { ...(readOpenApiRecord(components.schemas) ?? {}) };
	for (const [file, entry] of schemas) {
		const schema: OpenApiRecord = entry.schema;
		const {
			$id: _id,
			$schema: _dialect,
			definitions: nested,
			...shape
		} = schema;
		definitions[entry.name] = rewrite(shape, file);
		for (const [name, definition] of Object.entries(
			readOpenApiRecord(nested) ?? {}
		))
			definitions[entry.name + '__' + name] = rewrite(definition, file);
	}
	// Use the runtime DTO definition rather than maintaining a second hand-written schema.
	definitions.HistoryArchiveTransitionReconciliationV1 =
		HistoryArchiveStatusSummaryV1Schema.properties.transitionReconciliation;
	return { ...rewritten, components: { ...components, schemas: definitions } };
}

function rewrite(value: unknown, file?: string): unknown {
	if (Array.isArray(value)) return value.map((item) => rewrite(item, file));
	const record = readOpenApiRecord(value);
	if (!record) return value;
	return Object.fromEntries(
		Object.entries(record).map(([key, item]) => [
			key,
			key === '$ref' && typeof item === 'string'
				? localReference(item, file)
				: rewrite(item, file)
		])
	);
}

function localReference(reference: string, file?: string): string {
	if (file === undefined && reference.startsWith('#/')) return reference;
	const url = new URL(
		reference,
		'https://stellaratlas.io/schemas/' + (file ?? '')
	);
	const target = url.pathname.slice('/schemas/'.length);
	if (
		url.origin !== 'https://stellaratlas.io' ||
		!url.pathname.startsWith('/schemas/') ||
		url.search ||
		!schemas.has(target)
	)
		throw new Error('Unregistered public schema reference: ' + reference);
	const entry = schemas.get(target)!;
	const fragment = decodeURIComponent(url.hash);
	if (fragment.startsWith('#/definitions/')) {
		const [name, ...tail] = fragment.slice('#/definitions/'.length).split('/');
		return (
			'#/components/schemas/' +
			pointer(entry.name + '__' + unpointer(name!)) +
			(tail.length ? '/' + tail.join('/') : '')
		);
	}
	if (fragment !== '' && !fragment.startsWith('#/'))
		throw new Error('Unsupported public schema anchor: ' + reference);
	return '#/components/schemas/' + pointer(entry.name) + fragment.slice(1);
}

/** Fail the source export before a renderer can attempt to fetch an unresolved ref. */
export function assertSelfContainedOpenApiDocument(document: unknown): void {
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		const record = readOpenApiRecord(value);
		if (!record) return;
		if (typeof record.$ref === 'string') {
			const ref = record.$ref;
			if (!ref.startsWith('#/'))
				throw new Error('External OpenAPI reference: ' + ref);
			const resolved = ref
				.slice(2)
				.split('/')
				.reduce<unknown>((current, segment) => {
					const key = unpointer(segment);
					return typeof current === 'object' &&
						current !== null &&
						Object.hasOwn(current, key)
						? (current as Record<string, unknown>)[key]
						: undefined;
				}, document);
			if (resolved === undefined)
				throw new Error('Unresolved OpenAPI reference: ' + ref);
		}
		Object.values(record).forEach(visit);
	};
	visit(document);
}
