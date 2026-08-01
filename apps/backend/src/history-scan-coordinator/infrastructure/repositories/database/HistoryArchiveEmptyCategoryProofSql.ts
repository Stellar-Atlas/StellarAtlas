const zeroHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const zeroXdrHash = '3z9hmASpL9tAVxktxD3XSOp3itxSvEmM6AUkwBS4ERk=';

export function emptyTransactionSetMatchesSql(alias: string): string {
	const regularHash = `encode(sha256(decode(
		${alias}.previous_ledger_header_hash, 'base64')), 'base64')`;
	const protocol20Hash = `encode(sha256(
		int4send(1) ||
		decode(${alias}.previous_ledger_header_hash, 'base64') ||
		int4send(2) ||
		int4send(0) || int4send(0) ||
		int4send(0) || int4send(0)
	), 'base64')`;
	const protocol23Hash = `encode(sha256(
		int4send(1) ||
		decode(${alias}.previous_ledger_header_hash, 'base64') ||
		int4send(2) ||
		int4send(0) || int4send(0) ||
		int4send(1) || int4send(0) || int4send(0)
	), 'base64')`;

	return `case
		when ${alias}.ledger = 1 then
			${alias}.transaction_set_hash = '${zeroHash}'
		when ${alias}.protocol_version is null
			or ${alias}.previous_ledger_header_hash is null
			or ${alias}.previous_ledger_header_hash !~
				'^[A-Za-z0-9+/]{43}=$' then false
		when ${alias}.protocol_version < 20 then
			${alias}.transaction_set_hash = ${regularHash}
		when ${alias}.protocol_version < 23 then
			${alias}.transaction_set_hash in (${protocol20Hash}, ${regularHash})
		else ${alias}.transaction_set_hash in (
			${protocol23Hash}, ${regularHash}
		)
	end`;
}

export function emptyTransactionResultSetMatchesSql(alias: string): string {
	return `case when ${alias}.ledger = 1
		then ${alias}.transaction_result_hash = '${zeroHash}'
		else ${alias}.transaction_result_hash = '${zeroXdrHash}'
	end`;
}
