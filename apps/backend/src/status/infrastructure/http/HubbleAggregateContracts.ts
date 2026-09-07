/** Shared REST and GraphQL aggregate query contract. No arbitrary SQL. */
export type HubbleAggregateFunction =
	'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export interface HubbleAggregate {
	readonly function: HubbleAggregateFunction;
	readonly field?: string;
	readonly alias: string;
}
export interface HubbleAggregateFields {
	readonly aggregations?: readonly HubbleAggregate[];
	readonly groupBy?: readonly string[];
	readonly minLedger?: number;
	readonly maxLedger?: number;
}
export interface HubbleAggregateColumn {
	readonly alias: string;
	readonly function: HubbleAggregateFunction;
	readonly field: string | null;
	readonly sourceType: string | null;
	readonly valueEncoding: 'string-or-null';
	readonly approximate: boolean;
}
