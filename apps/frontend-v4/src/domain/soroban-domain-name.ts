export const MAX_SOROBAN_DOMAIN_NAME_LENGTH = 67;

export function normalizeSorobanDomainName(value: string): string | null {
	const name = value.trim();
	if (
		name.length > MAX_SOROBAN_DOMAIN_NAME_LENGTH ||
		!/^(?:[A-Za-z]{1,15}\.){1,4}[Xx][Ll][Mm]$/.test(name)
	)
		return null;
	return name.toLowerCase();
}
