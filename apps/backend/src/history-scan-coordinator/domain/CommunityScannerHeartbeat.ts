export const communityScannerHeartbeatFreshnessMs = 5 * 60 * 1000;

export function getCommunityScannerHeartbeatCutoff(now: Date): Date {
	return new Date(now.getTime() - communityScannerHeartbeatFreshnessMs);
}
