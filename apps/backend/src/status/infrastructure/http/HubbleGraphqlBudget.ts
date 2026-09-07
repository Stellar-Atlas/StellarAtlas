import {
	GraphQLError,
	Kind,
	type ValidationRule,
	type SelectionSetNode,
	type FragmentDefinitionNode
} from 'graphql';
/** Request-wide work budget, shared by every analytics GraphQL resolver. */
export const hubbleGraphqlBudget = {
	maximumDepth: 32,
	maximumFields: 4096,
	maximumRootFields: 16,
	maximumQueryCost: 32
} as const;
const cheapRoots = new Set([
	'hubbleStatus',
	'hubbleDatasets',
	'__schema',
	'__type',
	'__typename'
]);
export const validateHubbleGraphqlBudget: ValidationRule = (context) => ({
	OperationDefinition(operation) {
		const fragments = new Map<string, FragmentDefinitionNode>();
		for (const definition of context.getDocument().definitions)
			if (definition.kind === Kind.FRAGMENT_DEFINITION)
				fragments.set(definition.name.value, definition);
		let fields = 0,
			roots = 0,
			cost = 0,
			exceeded = false;
		function walk(
			set: SelectionSetNode,
			depth: number,
			path: ReadonlySet<string>
		): void {
			if (exceeded) return;
			if (depth > hubbleGraphqlBudget.maximumDepth) {
				exceeded = true;
				return;
			}
			for (const selection of set.selections) {
				if (exceeded) return;
				if (selection.kind === Kind.FIELD) {
					fields++;
					if (depth === 1) {
						roots++;
						cost += cheapRoots.has(selection.name.value) ? 1 : 8;
					}
					if (
						fields > hubbleGraphqlBudget.maximumFields ||
						roots > hubbleGraphqlBudget.maximumRootFields ||
						cost > hubbleGraphqlBudget.maximumQueryCost
					) {
						exceeded = true;
						return;
					}
					if (selection.selectionSet)
						walk(selection.selectionSet, depth + 1, path);
				} else if (selection.kind === Kind.INLINE_FRAGMENT)
					walk(selection.selectionSet, depth, path);
				else {
					const name = selection.name.value,
						fragment = fragments.get(name);
					// Standard GraphQL rules report cycles; don't recurse indefinitely here.
					if (fragment && !path.has(name))
						walk(fragment.selectionSet, depth, new Set([...path, name]));
				}
			}
		}
		walk(operation.selectionSet, 1, new Set());
		if (exceeded)
			context.reportError(
				new GraphQLError(
					'GraphQL query exceeds the request budget; split it into smaller queries.',
					{
						nodes: operation,
						extensions: {
							code: 'QUERY_TOO_COMPLEX',
							limits: hubbleGraphqlBudget
						}
					}
				)
			);
	}
});
