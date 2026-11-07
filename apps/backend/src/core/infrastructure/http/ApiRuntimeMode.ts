/** The standby is a full request-serving API, not a second background writer. */
export function apiBackgroundTasksEnabled(
	environment: Readonly<Record<string, string | undefined>>
): boolean {
	const value = environment.API_BACKGROUND_TASKS_ENABLED;
	if (value === undefined || value === 'true') return true;
	if (value === 'false') return false;
	throw new Error('API_BACKGROUND_TASKS_ENABLED must be "true" or "false"');
}

/** Optional isolation for an off-traffic listener; ordinary binding is unchanged. */
export function apiListenHost(
	environment: Readonly<Record<string, string | undefined>>
): '127.0.0.1' | '::1' | undefined {
	const host = environment.API_BIND_HOST;
	if (host === undefined || host === '127.0.0.1' || host === '::1') return host;
	throw new Error('API_BIND_HOST must be a loopback address');
}
