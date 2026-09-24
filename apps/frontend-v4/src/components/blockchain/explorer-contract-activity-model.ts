import type { ContractActivityPage } from '../../api/explorer-contract-activity';

export interface ContractActivityState {
	readonly page: ContractActivityPage | null;
	readonly pageIndex: number;
	readonly positions: readonly string[];
	readonly requestedPosition: string;
	readonly requestedIndex: number;
	readonly requestId: number;
	readonly loading: boolean;
	readonly error: string | null;
}
export const initialContractActivityState: ContractActivityState = {
	page: null,
	pageIndex: 0,
	positions: [''],
	requestedPosition: '',
	requestedIndex: 0,
	requestId: 0,
	loading: true,
	error: null
};
type ActivityAction =
	| { readonly type: 'next' | 'previous' | 'retry' | 'refresh' }
	| {
			readonly type: 'loaded';
			readonly requestId: number;
			readonly page: ContractActivityPage;
	  }
	| {
			readonly type: 'failed';
			readonly requestId: number;
			readonly error: string;
	  };

export function contractActivityReducer(
	state: ContractActivityState,
	action: ActivityAction
): ContractActivityState {
	if (action.type === 'loaded') {
		if (action.requestId !== state.requestId) return state;
		return {
			...state,
			page: action.page,
			pageIndex: state.requestedIndex,
			positions: [
				...state.positions.slice(0, state.requestedIndex),
				state.requestedPosition
			],
			loading: false,
			error: null
		};
	}
	if (action.type === 'failed')
		return action.requestId !== state.requestId
			? state
			: { ...state, loading: false, error: action.error };
	if (state.loading) return state;
	let requestedPosition = state.requestedPosition,
		requestedIndex = state.requestedIndex;
	if (action.type === 'next') {
		if (!state.page || state.page.nextPosition === null) return state;
		requestedPosition = state.page.nextPosition;
		requestedIndex = state.pageIndex + 1;
	} else if (action.type === 'previous') {
		if (state.pageIndex === 0) return state;
		requestedIndex = state.pageIndex - 1;
		requestedPosition = state.positions[requestedIndex]!;
	} else if (action.type === 'refresh') {
		requestedIndex = state.pageIndex;
		requestedPosition = state.positions[requestedIndex]!;
	}
	return {
		...state,
		requestedPosition,
		requestedIndex,
		requestId: state.requestId + 1,
		loading: true,
		error: null
	};
}

/** Pretty-print JSON tokens without rounding numeric values through JavaScript. */
export function formatContractJson(value: unknown): string {
	if (typeof value !== 'string') return JSON.stringify(value ?? null, null, 2);
	try {
		JSON.parse(value);
	} catch {
		return value;
	}
	let output = '',
		depth = 0,
		quoted = false,
		escaped = false;
	const newline = () => '\n' + '  '.repeat(Math.min(depth, 32));
	for (const char of value) {
		if (quoted) {
			output += char;
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') quoted = false;
		} else if (char === '"') {
			quoted = true;
			output += char;
		} else if (char === '{' || char === '[') {
			depth += 1;
			output += char + newline();
		} else if (char === '}' || char === ']') {
			depth -= 1;
			output += newline() + char;
		} else if (char === ',') output += char + newline();
		else if (char === ':') output += ': ';
		else if (!/\s/.test(char)) output += char;
	}
	return output;
}
