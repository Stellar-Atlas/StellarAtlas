export const formatInteger = (value: number): string =>
	new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

export const formatPercent = (value: number): string =>
	new Intl.NumberFormat('en-US', {
		maximumFractionDigits: 1,
		minimumFractionDigits: value === 100 ? 0 : 1,
		style: 'percent'
	}).format(value / 100);

export const formatDateTime = (value: string): string =>
	new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC'
	}).format(new Date(value));

export const formatBoolean = (value: boolean): string => (value ? 'Yes' : 'No');
