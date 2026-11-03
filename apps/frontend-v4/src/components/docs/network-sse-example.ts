import { api } from './developer-guide-elements';

export const networkSseExample = `const networkEvents = new EventSource('${api}/v1/live');
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
// Call stopNetworkUpdates() when the view closes.`;
