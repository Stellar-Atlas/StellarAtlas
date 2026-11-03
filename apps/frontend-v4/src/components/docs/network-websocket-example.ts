export const networkWebSocketExample = `const networkSocket = new WebSocket('wss://api.stellaratlas.io/v1/live/ws?channels=summary,scp&scpMode=graph');
let networkSocketStopped = false;

networkSocket.onmessage = ({ data }) => {
  if (networkSocketStopped || typeof data !== 'string') return;
  let envelope;
  try { envelope = JSON.parse(data); } catch { return; }
  if (!envelope ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      !('type' in envelope) ||
      typeof envelope.type !== 'string') return;
  if (envelope.type === 'error') {
    console.error('Network/SCP read unavailable; retain saved data:', data);
    return;
  }
  if (!['summary', 'latestLedger', 'scpGraph', 'heartbeat'].includes(envelope.type)) return;
  if (envelope.type === 'scpGraph') {
    if ('truncated' in envelope && envelope.truncated === true)
      console.warn('Bounded SCP update; do not infer complete history.');
    if ('freshness' in envelope && envelope.freshness !== 'fresh')
      console.warn('SCP observations are not fresh; inspect metadata.');
  }
  console.log('Network/SCP message JSON:', data);
};
networkSocket.onerror = () => {
  if (networkSocketStopped) return;
  console.error('Network connection unavailable; retain saved data.');
  stopNetworkSocket();
};
networkSocket.onclose = () => {
  if (networkSocketStopped) return;
  networkSocketStopped = true;
  console.info('Network stream closed; recheck source/freshness before reconnecting.');
};

function stopNetworkSocket() {
  if (networkSocketStopped) return;
  networkSocketStopped = true;
  networkSocket.close();
}
// Single session: call stopNetworkSocket() when the view closes.`;
