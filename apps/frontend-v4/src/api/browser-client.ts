const getBrowserApiBaseUrl = (): string => {
	const configuredUrl = process.env.NEXT_PUBLIC_STELLAR_ATLAS_API_URL?.trim();
	if (configuredUrl && configuredUrl.length > 0) {
		return configuredUrl.endsWith('/')
			? configuredUrl.slice(0, -1)
			: configuredUrl;
	}

	if (
		window.location.hostname === 'stellaratlas.io' ||
		window.location.hostname.endsWith('.stellaratlas.io')
	) {
		return 'https://api.stellaratlas.io';
	}

	if (
		window.location.hostname === 'localhost' ||
		window.location.hostname === '127.0.0.1'
	) {
		return window.location.origin;
	}

	return window.location.origin;
};

export const buildBrowserRealtimeUrl = (path: string): string => {
	const configuredUrl =
		process.env.NEXT_PUBLIC_STELLAR_ATLAS_WS_URL?.trim() ?? '';
	if (configuredUrl.length > 0) {
		const url = new URL(path, configuredUrl);
		return url.toString();
	}

	const apiUrl = new URL(path, getBrowserApiBaseUrl());
	if (
		(apiUrl.hostname === 'localhost' || apiUrl.hostname === '127.0.0.1') &&
		apiUrl.port !== '3000'
	) {
		apiUrl.hostname = '127.0.0.1';
		apiUrl.port = '3000';
	}
	apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
	return apiUrl.toString();
};
