import { api } from './developer-guide-elements';
import { graphqlAnalyticsExamples } from './graphql-analytics-examples';

export const graphqlErrorExample = `const request = ${JSON.stringify({ query: graphqlAnalyticsExamples.operations.query, variables: graphqlAnalyticsExamples.operations.variables }, null, 2)};
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
let response;
try {
  response = await fetch('${api}/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/graphql-response+json'
    },
    body: JSON.stringify(request),
    signal: controller.signal
  });
  const responseText = await response.text();
  let result = null;
  try { result = JSON.parse(responseText); } catch {}
  const object = result !== null && typeof result === 'object' && !Array.isArray(result);
  if (object && result.errors !== undefined && !Array.isArray(result.errors)) {
    throw new Error('Invalid GraphQL errors response');
  }
  if (object && result.errors?.length) {
    console.error('GraphQL errors (HTTP ' + response.status + '):', responseText);
    if (result.data != null) {
      console.warn('Partial data; keep the previous page and do not advance pagination.');
    }
  } else if (!response.ok) {
    console.error('HTTP ' + response.status + ' without GraphQL errors:', responseText);
  } else {
    if (!object || !result.data?.hubbleOperations) throw new Error('Missing valid operation page');
    console.log('Operation response JSON:', responseText);
  }
} catch (error) {
  const message = controller.signal.aborted
    ? 'Request deadline exceeded; the server outcome may be unknown'
    : response
      ? 'Response handling failed (HTTP ' + response.status + ')'
      : 'No HTTP response: network or browser request failure';
  console.error(message, error);
} finally {
  clearTimeout(timeout);
}`;
