export type OperationInvocation = {
	contractId: string;
	functionName: string;
	arguments: readonly unknown[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isContractAddress = (value: unknown): value is string =>
	typeof value === 'string' && /^C[A-Z2-7]{55}$/.test(value);

const isNonemptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

const typedArgument = (value: unknown): unknown => {
	if (!isRecord(value) || typeof value.type !== 'string') return value;

	const wrapperKeys: Record<string, string> = {
		Address: 'address',
		Sym: 'symbol',
		Symbol: 'symbol',
		Bytes: 'bytes',
		U32: 'u32',
		U64: 'u64',
		I32: 'i32',
		I64: 'i64',
		U128: 'u128',
		I128: 'i128',
		U256: 'u256',
		I256: 'i256'
	};
	const key = wrapperKeys[value.type];
	return key ? { [key]: value.value } : value;
};

export function operationInvocation(
	row: Readonly<Record<string, unknown>>
): OperationInvocation | null {
	if (row.type !== 'invoke_host_function') return null;

	const details = row.details;
	if (!isRecord(details) || details.type !== 'invoke_contract') return null;

	const decoded = details.parameters_json_decoded;
	if (Array.isArray(decoded)) {
		const address = isRecord(decoded[0]) ? decoded[0].address : undefined;
		const symbol = isRecord(decoded[1]) ? decoded[1].symbol : undefined;
		if (isContractAddress(address) && isNonemptyString(symbol)) {
			const contractId = isContractAddress(details.contract_id)
				? details.contract_id
				: address;
			return {
				contractId,
				functionName: symbol,
				arguments: decoded.slice(2)
			};
		}
	}

	const typed = details.parameters_decoded;
	if (!Array.isArray(typed)) return null;

	const addressArgument = typed[0];
	const functionArgument = typed[1];
	if (!isRecord(addressArgument) || addressArgument.type !== 'Address') {
		return null;
	}
	if (!isRecord(functionArgument)) return null;

	const address = addressArgument.value;
	const functionType = functionArgument.type;
	const functionName = functionArgument.value;
	if (
		!isContractAddress(address) ||
		(functionType !== 'Sym' && functionType !== 'Symbol') ||
		!isNonemptyString(functionName)
	) {
		return null;
	}

	const contractId = isContractAddress(details.contract_id)
		? details.contract_id
		: address;
	return {
		contractId,
		functionName,
		arguments: typed.slice(2).map(typedArgument)
	};
}
