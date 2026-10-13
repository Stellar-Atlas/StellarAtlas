import type { ContractEventValue } from './contract-event-value';

export interface ContractEventField {
	readonly path: string;
	readonly type: string;
	readonly value: ContractEventValue;
}

export interface FlattenedContractEventValue {
	readonly fields: readonly ContractEventField[];
	readonly truncated: boolean;
}

const defaultMaxFields = 256;
function mapKeySegment(key: ContractEventValue, index: number): string {
	while (key.kind === "typed") key = key.value;
	if (key.kind === "string" || key.kind === "number") return key.value;
	if (key.kind === "boolean") return `[boolean map key: ${key.value}]`;
	if (key.kind === "null") return "[null map key]";
	if (key.kind === "void") return "[void map key]";
	return `[unknown map key · entry ${index}]`;
}


/** Flatten generic decoded event values for tabular display without coercing leaf values. */
export function flattenContractEventValue(
	value: ContractEventValue,
	maxFields = defaultMaxFields
): FlattenedContractEventValue {
	const limit = Number.isSafeInteger(maxFields) && maxFields > 0 ? maxFields : defaultMaxFields;
	const fields: ContractEventField[] = [];
	let truncated = false;

	const visit = (node: ContractEventValue, path: string, inheritedType = '', root = false): void => {
		if (fields.length >= limit) {
			truncated = true;
			return;
		}
		if (node.kind === 'typed') {
			const type = inheritedType ? `${inheritedType} / ${node.typeName}` : node.typeName;
			visit(node.value, path, type, root);
			return;
		}
		if (node.kind === 'object' && node.entries.length > 0) {
			for (const [index, entry] of node.entries.entries()) {
				const segment = entry.key ? mapKeySegment(entry.key, index) : entry.label || 'Field';
				visit(entry.value, root ? segment : `${path}.${segment}`, inheritedType);
				if (truncated) return;
			}
			return;
		}
		if (node.kind === 'array' && node.items.length > 0) {
			for (let index = 0; index < node.items.length; index += 1) {
				visit(node.items[index]!, `${path}[${index}]`, inheritedType, false);
				if (truncated) return;
			}
			return;
		}
		fields.push({ path, type: inheritedType || node.kind, value: node });
	};

	visit(value, value.label ?? 'Value', '', true);
	return { fields, truncated };
}
