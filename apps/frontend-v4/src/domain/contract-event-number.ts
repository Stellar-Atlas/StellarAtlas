const MAX_DIGITS = 2048;
const MAX_EXPONENT = 1024;

/** Display a numeric token exactly. Never coerce its coefficient through Number. */
export function formatContractEventNumber(text: string): string {
	if (text.length > MAX_DIGITS) return text;
	const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
	if (!match) return text;
	const [, sign = '', whole = '', fraction = '', exponentText] = match;
	let integer = whole, decimal = fraction;
	if (exponentText !== undefined) {
		// Only the bounded exponent is converted, never the exact significant digits.
		if (exponentText.length > 5) return text;
		const exponent = Number(exponentText);
		if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_EXPONENT) return text;
		const digits = whole + fraction, point = whole.length + exponent;
		const size = point <= 0 ? 1 - point + digits.length : Math.max(point, digits.length);
		if (size > MAX_DIGITS) return text;
		if (point <= 0) { integer = '0'; decimal = '0'.repeat(-point) + digits; }
		else if (point >= digits.length) { integer = digits + '0'.repeat(point - digits.length); decimal = ''; }
		else { integer = digits.slice(0, point); decimal = digits.slice(point); }
		integer = integer.replace(/^0+(?=\d)/, '');
	}
	const groups: string[] = [];
	for (let end = integer.length; end > 0; end -= 3) groups.push(integer.slice(Math.max(0, end - 3), end));
	return sign + groups.reverse().join(',') + (decimal ? '.' + decimal : '');
}
