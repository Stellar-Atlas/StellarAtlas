export type ContractEventValue =
	| { readonly kind: 'null'; readonly label: string | null }
	| {
			readonly kind: 'boolean';
			readonly label: string | null;
			readonly value: boolean;
	  }
	| {
			readonly kind: 'number';
			readonly label: string | null;
			readonly value: string;
	  }
	| {
			readonly kind: 'string';
			readonly label: string | null;
			readonly value: string;
	  }
	| {
			readonly kind: 'typed';
			readonly label: string | null;
			readonly typeName: string;
			readonly value: ContractEventValue;
	  }
	| { readonly kind: 'void'; readonly label: string | null }
	| {
			readonly kind: 'bytes';
			readonly label: string | null;
			readonly hex: string;
			readonly encoding: 'utf-8' | 'hex';
			readonly text?: string;
			readonly interpretation?: {
				readonly label: 'Embedded XDR interpretation';
				readonly value: ContractEventValue;
			};
	  }
	| {
			readonly kind: 'array';
			readonly label: string | null;
			readonly items: readonly ContractEventValue[];
	  }
	| {
			readonly kind: 'object';
			readonly label: string | null;
			readonly entries: readonly {
				readonly label: string;
				readonly key?: ContractEventValue;
				readonly value: ContractEventValue;
			}[];
	  }
	| {
			readonly kind: 'raw';
			readonly label: string | null;
			readonly text: string;
			readonly reason: 'invalid-json' | 'unsupported-value' | 'limit-exceeded';
	  };

export type ContractEventBytesInterpreter = (
	bytes: Uint8Array
) => ContractEventValue | null;

export interface ContractEventValueOptions {
	readonly maxDepth?: number;
	readonly maxNodes?: number;
	readonly interpretBytes?: ContractEventBytesInterpreter;
}

const maxInputLength = 1_000_000;
const maxByteLength = 65_536;
const defaultMaxDepth = 48;
const defaultMaxNodes = 10_000;
const jsonNumber = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const controls = /\p{Cc}/u;
const bidiFormatting = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Decode archive event JSON without rounding JSON number tokens or interpreting contract-specific formats. */
export function decodeContractEventValue(
	input: unknown,
	options: ContractEventValueOptions = {}
): ContractEventValue {
	const label = null;
	if (typeof input !== 'string') {
		const budget: DecodeBudget = {
			maxDepth: options.maxDepth ?? defaultMaxDepth,
			maxNodes: options.maxNodes ?? defaultMaxNodes,
			nodes: 0,
			activeObjects: new WeakSet()
		};
		try {
			return normalizeScValNode(
				decodeDirectValue(input, label, options, budget, 0)
			);
		} catch {
			return {
				kind: 'raw',
				label,
				text: 'Value omitted because its structure exceeds the safe decoding limits.',
				reason: 'limit-exceeded'
			};
		}
	}
	if (input.length > maxInputLength) {
		return { kind: 'raw', label, text: input, reason: 'limit-exceeded' };
	}
	try {
		return normalizeScValNode(new JsonValueParser(input, options).parse());
	} catch (error) {
		return {
			kind: 'raw',
			label,
			text: input,
			reason: error instanceof ParseLimitError ? 'limit-exceeded' : 'invalid-json'
		};
	}
}

/** Normalize only exact Stellar ScVal `toJSON()` wrapper shapes; never infer application-specific meaning. */
export function normalizeScValNode(value: ContractEventValue): ContractEventValue {
	if (value.kind === 'array') {
		return { ...value, items: value.items.map(normalizeScValNode) };
	}
	if (value.kind !== 'object') return value;
	const entries = value.entries.map((entry) => ({
		...entry,
		value: normalizeScValNode(entry.value)
	}));
	if (entries.length !== 1) return { ...value, entries };
	const wrapper = entries[0]!;
	const typeName = wrapper.label;
	if (typeName === 'void') return { kind: 'void', label: value.label };
	if (typeName === 'vec' && wrapper.value.kind === 'array') {
		return { kind: 'array', label: value.label, items: wrapper.value.items };
	}
	if (typeName === 'map' && wrapper.value.kind === 'array') {
		const isEntry = (item: ContractEventValue): item is Extract<ContractEventValue, { kind: 'object' }> =>
			item.kind === 'object' &&
				item.entries.length === 2 &&
				item.entries.some((entry) => entry.label === 'key') &&
				item.entries.some((entry) => entry.label === 'val');
		if (!wrapper.value.items.every(isEntry)) return { ...value, entries };
		const mapEntries = wrapper.value.items.map((item, index) => {
			const key = normalizeScValNode(item.entries.find((entry) => entry.label === 'key')!.value);
			const mappedValue = normalizeScValNode(item.entries.find((entry) => entry.label === 'val')!.value);
			return { label: mapKeyLabel(key, index), key, value: mappedValue };
		});
		return { kind: 'object', label: value.label, entries: mapEntries };
	}
	if (
		['symbol', 'string', 'address', 'bool', 'u32', 'i32', 'u64', 'i64', 'u128', 'i128', 'u256', 'i256', 'timepoint', 'duration', 'error'].includes(typeName)
	) {
		return {
			kind: 'typed',
			label: value.label,
			typeName,
			value: wrapper.value
		};
	}
	return { ...value, entries };
}

function mapKeyLabel(key: ContractEventValue, index: number): string {
	if (key.kind === 'typed' && key.value.kind === 'string') return key.value.value;
	if (key.kind === 'typed' && key.value.kind === 'number') return key.value.value;
	if (key.kind === 'string') return key.value;
	if (key.kind === 'number') return key.value;
	if (key.kind === 'void') return '[void key]';
	return `[entry ${index}]`;
}

function decodeDirectValue(
	input: unknown,
	label: string | null,
	options: ContractEventValueOptions,
	budget: DecodeBudget,
	depth: number
): ContractEventValue {
	budget.nodes += 1;
	if (depth > budget.maxDepth || budget.nodes > budget.maxNodes) {
		throw new ParseLimitError('Value limit exceeded');
	}
	if (input === null) return { kind: 'null', label };
	if (typeof input === 'boolean') return { kind: 'boolean', label, value: input };
	if (typeof input === 'string') {
		if (input.length > maxInputLength) throw new ParseLimitError('String limit exceeded');
		return { kind: 'string', label, value: input };
	}
	if (typeof input === 'number') {
		if (!Number.isFinite(input) || !Number.isSafeInteger(input) && Number.isInteger(input)) {
			return {
				kind: 'raw',
				label,
				text: 'Number arrived as a JavaScript value without an exact source token.',
				reason: 'unsupported-value'
			};
		}
		return { kind: 'number', label, value: String(input) };
	}
	if (typeof input === 'bigint')
		return { kind: 'number', label, value: input.toString() };
	if (Array.isArray(input)) {
		return withActiveObject(input, budget, () => ({
			kind: 'array',
			label,
			items: input.map((item, index) =>
				decodeDirectValue(item, `[${index}]`, options, budget, depth + 1)
			)
		}));
	}
	if (typeof input === 'object') {
		return withActiveObject(input, budget, () => {
			const entries = Object.entries(input as Record<string, unknown>);
			if (
				entries.length === 1 &&
				entries[0]?.[0] === 'bytes' &&
				typeof entries[0][1] === 'string'
			) {
				return decodeBytes(entries[0][1], label, options.interpretBytes);
			}
			return {
			kind: 'object',
			label,
			entries: entries.map(([key, value]) => ({
				label: key,
				value: decodeDirectValue(value, key, options, budget, depth + 1)
			}))
			};
		});
	}
	return {
		kind: 'raw',
		label,
		text: String(input),
		reason: 'unsupported-value'
	};
}

interface DecodeBudget {
	readonly maxDepth: number;
	readonly maxNodes: number;
	nodes: number;
	readonly activeObjects: WeakSet<object>;
}

function withActiveObject<T>(object: object, budget: DecodeBudget, action: () => T): T {
	if (budget.activeObjects.has(object)) throw new ParseLimitError('Cyclic value');
	budget.activeObjects.add(object);
	try {
		return action();
	} finally {
		budget.activeObjects.delete(object);
	}
}

function decodeBytes(
	hex: string,
	label: string | null,
	interpreter: ContractEventBytesInterpreter | undefined
): ContractEventValue {
	const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (normalized.length > maxByteLength * 2) {
		return {
			kind: 'raw',
			label,
			text: 'Byte value omitted because it exceeds the safe decoding limit.',
			reason: 'limit-exceeded'
		};
	}
	if (normalized.length % 2 !== 0 || !/^[\da-f]*$/i.test(normalized)) {
		return { kind: 'object', label, entries: [{ label: 'bytes', value: { kind: 'string', label: 'bytes', value: hex } }] };
	}
	const bytes = new Uint8Array(normalized.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
	}
	let text: string | undefined;
	try {
		const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		if (
			!controls.test(decoded.replace(/[\t\n\r]/g, '')) &&
			!bidiFormatting.test(decoded)
		) {
			text = decoded;
		}
	} catch {
		// Invalid UTF-8 stays an explicit hex/binary value.
	}
	let interpretation: ContractEventValue | null = null;
	if (interpreter !== undefined) {
		try {
			interpretation = interpreter(bytes);
		} catch {
			// A contract-specific parser must never hide the original bytes.
		}
	}
	return {
		kind: 'bytes',
		label,
		hex,
		encoding: text === undefined ? 'hex' : 'utf-8',
		...(text === undefined ? {} : { text }),
		...(interpretation === null
			? {}
			: {
					interpretation: {
						label: 'Embedded XDR interpretation' as const,
						value: interpretation
					}
				})
	};
}

class ParseLimitError extends Error {}

type JsonParserOptions = Pick<
	ContractEventValueOptions,
	'maxDepth' | 'maxNodes' | 'interpretBytes'
>;

class JsonValueParser {
	private offset = 0;
	private nodes = 0;
	private readonly maxDepth: number;
	private readonly maxNodes: number;

	constructor(
		private readonly source: string,
		private readonly options: JsonParserOptions
	) {
		this.maxDepth = options.maxDepth ?? defaultMaxDepth;
		this.maxNodes = options.maxNodes ?? defaultMaxNodes;
	}

	parse(): ContractEventValue {
		const value = this.value(null, 0);
		this.space();
		if (this.offset !== this.source.length) throw new SyntaxError('Trailing JSON');
		return value;
	}

	private value(label: string | null, depth: number): ContractEventValue {
		this.nodes += 1;
		if (depth > this.maxDepth || this.nodes > this.maxNodes) {
			throw new ParseLimitError('JSON value limit exceeded');
		}
		this.space();
		const char = this.source[this.offset];
		if (char === '{') return this.object(label, depth);
		if (char === '[') return this.array(label, depth);
		if (char === '"') return { kind: 'string', label, value: this.string() };
		if (char === 't' && this.take('true')) return { kind: 'boolean', label, value: true };
		if (char === 'f' && this.take('false')) return { kind: 'boolean', label, value: false };
		if (char === 'n' && this.take('null')) return { kind: 'null', label };
		const number = jsonNumber;
		number.lastIndex = this.offset;
		const match = number.exec(this.source);
		if (match?.[0]) {
			this.offset = number.lastIndex;
			return { kind: 'number', label, value: match[0] };
		}
		throw new SyntaxError('Invalid JSON value');
	}

	private object(label: string | null, depth: number): ContractEventValue {
		this.offset += 1;
		this.space();
		const entries: { label: string; value: ContractEventValue }[] = [];
		if (this.source[this.offset] === '}') this.offset += 1;
		else {
			while (true) {
				this.space();
				if (this.source[this.offset] !== '"') throw new SyntaxError('Invalid object key');
				const key = this.string();
				this.space();
				if (this.source[this.offset] !== ':') throw new SyntaxError('Expected colon');
				this.offset += 1;
				entries.push({ label: key, value: this.value(key, depth + 1) });
				this.space();
				if (this.source[this.offset] === '}') {
					this.offset += 1;
					break;
				}
				if (this.source[this.offset] !== ',') throw new SyntaxError('Expected comma');
				this.offset += 1;
			}
		}
		if (
			entries.length === 1 &&
			entries[0]?.label === 'bytes' &&
			entries[0].value.kind === 'string'
		) {
			return decodeBytes(
				entries[0].value.value,
				label,
				this.options.interpretBytes
			);
		}
		return { kind: 'object', label, entries };
	}

	private array(label: string | null, depth: number): ContractEventValue {
		this.offset += 1;
		this.space();
		const items: ContractEventValue[] = [];
		if (this.source[this.offset] === ']') this.offset += 1;
		else {
			while (true) {
				items.push(this.value(`[${items.length}]`, depth + 1));
				this.space();
				if (this.source[this.offset] === ']') {
					this.offset += 1;
					break;
				}
				if (this.source[this.offset] !== ',') throw new SyntaxError('Expected comma');
				this.offset += 1;
			}
		}
		return { kind: 'array', label, items };
	}

	private string(): string {
		const start = this.offset;
		this.offset += 1;
		let escaped = false;
		while (this.offset < this.source.length) {
			const char = this.source[this.offset];
			this.offset += 1;
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') {
				return JSON.parse(this.source.slice(start, this.offset)) as string;
			}
		}
		throw new SyntaxError('Unterminated JSON string');
	}

	private take(token: string): boolean {
		if (!this.source.startsWith(token, this.offset)) return false;
		this.offset += token.length;
		return true;
	}

	private space(): void {
		while (/\s/.test(this.source[this.offset] ?? '')) this.offset += 1;
	}
}
