export const staleScanJobAgeMs = 4 * 24 * 60 * 60 * 1000;

export function getStaleScanJobCutoff(now = new Date()): Date {
	return new Date(now.getTime() - staleScanJobAgeMs);
}
