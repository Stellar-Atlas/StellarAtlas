import { isRecord, parseGraphqlVariables } from './graphql-request';

export const transactionRelations = [
	'operations',
	'effects',
	'events'
] as const;
export type TransactionRelation = (typeof transactionRelations)[number];

export function transactionPageVariables(
	variablesText: string,
	result: unknown,
	relation: TransactionRelation
): string | null {
	const variables = parseGraphqlVariables(variablesText);
	if (!isRecord(result) || result.errors || !isRecord(result.data)) return null;
	const detail = result.data.hubbleTransaction;
	if (!isRecord(detail) || !isRecord(detail[relation])) return null;
	const cursor = detail[relation].nextCursor;
	if (typeof cursor !== 'string' || !cursor) return null;
	return JSON.stringify(
		{ ...variables, [relation + 'After']: cursor },
		null,
		2
	);
}
