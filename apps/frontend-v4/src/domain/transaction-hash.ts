const transactionHashPattern = /^[a-f0-9]{64}$/i;

export const normalizeTransactionHash = (value: string): string | null => {
	const normalized = value.trim().toLowerCase();
	return transactionHashPattern.test(normalized) ? normalized : null;
};
