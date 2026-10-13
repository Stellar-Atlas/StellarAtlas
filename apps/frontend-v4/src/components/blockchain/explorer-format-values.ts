export function formatAtomic(value: string, decimals: number): string {
	if (
		!/^-?\d+$/.test(value) ||
		!Number.isInteger(decimals) ||
		decimals < 0 ||
		decimals > 38
	)
		return value;
	const negative = value.startsWith('-');
	const digits = (negative ? value.slice(1) : value).padStart(
		decimals + 1,
		'0'
	);
	const whole = decimals ? digits.slice(0, -decimals) : digits;
	const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
	return (
		(negative ? '-' : '') +
		BigInt(whole).toLocaleString('en-US') +
		(fraction ? '.' + fraction : '')
	);
}

export function formatDecimal(value: string | number, decimals = 7): string {
	const text = String(value);
	if (!text.trim()) return '—';
	if (/^-?\d+$/.test(text)) return BigInt(text).toLocaleString('en-US');
	const number = Number(value);
	return Number.isFinite(number)
		? number.toLocaleString('en-US', { maximumFractionDigits: decimals })
		: text;
}

export function timestampValue(value: string, field: string): string | null {
	if (
		!/(?:^|[_ .])timestamp$|(?:^|[_ .])time$/.test(field.toLowerCase()) ||
		!/^\d{9,19}$/.test(value)
	)
		return null;
	const magnitude = BigInt(value);
	const milliseconds =
		magnitude > 100000000000000000n
			? magnitude / 1000000n
			: magnitude > 100000000000000n
				? magnitude / 1000n
				: magnitude < 100000000000n
					? magnitude * 1000n
					: magnitude;
	const date = new Date(Number(milliseconds));
	return Number.isFinite(date.getTime()) &&
		date.getUTCFullYear() >= 2000 &&
		date.getUTCFullYear() <= 2100
		? date.toISOString()
		: null;
}
