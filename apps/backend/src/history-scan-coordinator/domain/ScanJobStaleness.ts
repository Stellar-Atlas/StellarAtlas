export const staleScanJobAgeMs = 30 * 60 * 1000;

export function getStaleScanJobCutoff(now = new Date()): Date {
	return new Date(now.getTime() - staleScanJobAgeMs);
}
