export interface NetworkSseEvent {
	readonly data?: string;
}
interface ExampleEventSource {
	addEventListener(
		name: string,
		listener: (event: NetworkSseEvent) => void
	): void;
	close(): void;
}
export interface NetworkSseEnvironment {
	readonly EventSource: new (url: string) => ExampleEventSource;
	readonly console: {
		log(...values: unknown[]): void;
		error(...values: unknown[]): void;
	};
}

/** Normally imported executable fixture; the entire displayed body is checked separately. */
export function createNetworkSseSession(environment: NetworkSseEnvironment) {
	const { EventSource, console } = environment;
	const networkEvents = new EventSource('https://api.stellaratlas.io/v1/live');
	let networkUpdatesStopped = false;

	networkEvents.addEventListener('network', ({ data }) => {
		if (networkUpdatesStopped) return;
		console.log('Network snapshot JSON:', data);
	});
	networkEvents.addEventListener('error', (event) => {
		if (networkUpdatesStopped) return;
		stopNetworkUpdates();
		const detail = 'data' in event ? event.data : 'SSE connection interrupted';
		console.error('Network refresh unavailable; retain saved data:', detail);
	});

	function stopNetworkUpdates() {
		if (networkUpdatesStopped) return;
		networkUpdatesStopped = true;
		networkEvents.close();
	}
	return stopNetworkUpdates;
}
