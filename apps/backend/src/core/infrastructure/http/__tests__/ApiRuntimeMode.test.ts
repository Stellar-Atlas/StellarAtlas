import { apiBackgroundTasksEnabled, apiListenHost } from '../ApiRuntimeMode.js';

describe('API background ownership and off-traffic binding', () => {
	it('preserves the normal launch defaults and accepts the single-process standby settings', () => {
		expect(apiBackgroundTasksEnabled({})).toBe(true);
		expect(apiListenHost({})).toBeUndefined();
		expect(apiBackgroundTasksEnabled({ API_BACKGROUND_TASKS_ENABLED: 'false' })).toBe(false);
		expect(apiBackgroundTasksEnabled({ API_BACKGROUND_TASKS_ENABLED: 'true' })).toBe(true);
		expect(apiListenHost({ API_BIND_HOST: '127.0.0.1' })).toBe('127.0.0.1');
		expect(apiListenHost({ API_BIND_HOST: '::1' })).toBe('::1');
	});
	it.each(['', 'FALSE', 'yes', '0'])('refuses ambiguous ownership setting %j', (value) => {
		expect(() => apiBackgroundTasksEnabled({ API_BACKGROUND_TASKS_ENABLED: value })).toThrow();
	});
	it.each(['', '0.0.0.0', '::', 'localhost', '192.168.1.220'])('refuses a non-loopback explicit bind %j', (value) => {
		expect(() => apiListenHost({ API_BIND_HOST: value })).toThrow();
	});
});
