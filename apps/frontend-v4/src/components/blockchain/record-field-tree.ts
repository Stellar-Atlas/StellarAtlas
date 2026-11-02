export const recordTreeLimits = { rows: 20, depth: 4, nodes: 160, expanded: 40, jsonCharacters: 262144 } as const;

/** Decode only structured source fields; preserve opaque, oversized or lossy JSON verbatim. */
export function recordFieldInput(value: unknown): unknown {
	if (typeof value !== 'string' || value.length > recordTreeLimits.jsonCharacters || !/^[\s]*[\[{]/.test(value)) return value;
	try {
		// Inspect original tokens BEFORE JSON.parse can round fractions or underflow.
		// Quoted text is skipped. Conservatively keep decimal/exponent/negative-zero
		// literals raw; only canonical safe integers enter the structured renderer.
		for (const token of value.matchAll(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
			const number = token[1];
			if (number !== undefined && (!Number.isSafeInteger(Number(number)) || String(Number(number)) !== number)) return value;
		}
		return JSON.parse(value) as unknown;
	} catch { return value; }
}
export interface RecordFieldNode {
	readonly field: string;
	readonly label: string;
	readonly path: string;
	readonly value: unknown;
	readonly count: number | null;
	readonly array: boolean;
	readonly expandable: boolean;
	readonly children?: RecordFieldLevel;
}
export interface RecordFieldLevel {
	readonly nodes: readonly RecordFieldNode[];
	readonly omitted: number;
}

/** Only expanded branches are visited; limits apply to the whole visible tree. */
export function recordFieldTree(value: unknown, expanded: ReadonlySet<string>, exclude: readonly string[] = []): RecordFieldLevel {
	let remaining = recordTreeLimits.nodes as number;
	function level(input: unknown, path: string, depth: number, parent = ''): RecordFieldLevel {
		const array = Array.isArray(input);
		const entries: [string, unknown][] = array
			? input.slice(0, recordTreeLimits.rows).map((item, index) => [String(index), item])
			: typeof input === 'object' && input !== null
				? Object.entries(input).filter(([field]) => depth !== 0 || !exclude.includes(field)) : [];
		const total = array ? input.length : entries.length;
		const nodes: RecordFieldNode[] = [];
		for (const [key, item] of entries.slice(0, recordTreeLimits.rows)) {
			if (remaining <= 0) break;
			remaining--;
			const itemPath = path + '.' + key.length + ':' + key;
			const structured = typeof item === 'object' && item !== null;
			const count = structured ? Array.isArray(item) ? item.length : Object.keys(item).length : null;
			const expandable = count !== null && count > 0 && depth < recordTreeLimits.depth;
			nodes.push({ field: array ? parent : key, label: array ? `Item ${Number(key) + 1}` : key.replaceAll('_', ' '), path: itemPath,
				value: item, count, array: Array.isArray(item), expandable,
				...(expandable && expanded.has(itemPath) ? { children: level(item, itemPath, depth + 1, array ? parent : key) } : {}) });
		}
		return { nodes, omitted: total - nodes.length };
	}
	return level(value, 'record', 0);
}
